import request from "supertest";
import { createApp } from "../../src/app";
import { env } from "../../src/config/env";
import { Ticket } from "../../src/models";
import { resetManagerCache } from "../../src/modules/manager/manager.service";
import { bearer } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { createTicket, createUser, scenario } from "../helpers/factories";
import { resetRedis } from "../helpers/redis";

const app = createApp();

const catalog = {
  usuarios: [{ cod_usuario: 3, nome: "Yure", email: "yure@connect.com", celular: null }],
  produtos: [{ cod_produto: 7, descricao: "WHATSON" }],
  tipos_atendimento: [{ cod_tipo_atendimento: 1, descricao: "SUPORTE" }],
  colunas: [],
  prioridades_os: [],
  prioridades_atendimento: [],
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("manager integration", () => {
  let fetchMock: jest.SpyInstance;
  const calls: { url: string; init?: RequestInit }[] = [];

  beforeEach(async () => {
    await resetDb();
    await resetRedis();
    resetManagerCache();
    calls.length = 0;
    env.MANAGER_API_URL = "https://manager.test";
    env.MANAGER_API_TOKEN = "token-de-teste-0123456789";
    fetchMock = jest.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes("/catalogos/")) return json(200, catalog);
      if (url.includes("/clientes/")) return json(200, { clientes: [{ cod_cliente: 123, nome: "HIPER", fantasia: null, cnpj: null, contato: null }] });
      if (url.includes("/os/")) return json(201, { cod_os: 1234, url: "https://manager.test/os/1234" });
      if (url.includes("/atendimentos/")) return json(201, { cod_atendimento: 5678 });
      return json(404, { erro: "não encontrado" });
    });
  });
  afterEach(() => {
    fetchMock.mockRestore();
    env.MANAGER_API_URL = undefined;
    env.MANAGER_API_TOKEN = undefined;
    env.MANAGER_COMPANY_ID = undefined;
  });

  async function setup(email = "yure@connect.com") {
    const s = await scenario();
    env.MANAGER_COMPANY_ID = s.company.id;
    const agent = await createUser(s.company.id, { profile: "agent", email });
    const ticket = await createTicket({ companyId: s.company.id, contactId: s.contact.id, connectionId: s.connection.id, status: "open", userId: agent.id });
    return { ...s, agent, ticket };
  }

  it("is enabled only for the configured company", async () => {
    const { agent } = await setup();
    const on = await request(app).get("/api/manager/status").set("Authorization", bearer(agent));
    expect(on.body).toEqual({ enabled: true });

    const other = await scenario();
    const stranger = await createUser(other.company.id, { profile: "admin" });
    const off = await request(app).get("/api/manager/status").set("Authorization", bearer(stranger));
    expect(off.body).toEqual({ enabled: false });
    expect((await request(app).get("/api/manager/catalog").set("Authorization", bearer(stranger))).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("suggests clients by the contact phone, sending the bearer token", async () => {
    const { agent, ticket, contact } = await setup();
    const res = await request(app).get(`/api/manager/clients?ticketId=${ticket.id}`).set("Authorization", bearer(agent));
    expect(res.status).toBe(200);
    expect(res.body.clientes[0].cod_cliente).toBe(123);
    expect(calls[0].url).toContain(`telefone=${contact.number}`);
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer token-de-teste-0123456789");
  });

  it("suggests clients by phone straight from the contact (contact registration)", async () => {
    const { agent, contact } = await setup();
    const res = await request(app).get(`/api/manager/clients?contactId=${contact.id}`).set("Authorization", bearer(agent));
    expect(res.status).toBe(200);
    expect(calls[0].url).toContain(`telefone=${contact.number}`);

    const foreign = (await scenario()).contact;
    expect((await request(app).get(`/api/manager/clients?contactId=${foreign.id}`).set("Authorization", bearer(agent))).status).toBe(404);
  });

  it("opens an OS as the Manager user with the same e-mail and stores it on the ticket", async () => {
    const { agent, ticket } = await setup();
    const res = await request(app)
      .post(`/api/tickets/${ticket.id}/manager/os`)
      .set("Authorization", bearer(agent))
      .send({ titulo: "PDV não imprime", descricao: "detalhes", prioridade: 3, codCliente: 123 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ managerOsId: 1234, managerOsUrl: "https://manager.test/os/1234" });
    const sent = JSON.parse(String(calls.find((c) => c.url.endsWith("/os/"))?.init?.body));
    expect(sent).toMatchObject({ cod_criador: 3, cod_cliente: 123, ticket_id: ticket.id, prioridade: 3 });

    const again = await request(app).post(`/api/tickets/${ticket.id}/manager/os`).set("Authorization", bearer(agent)).send({ titulo: "x", codCliente: 123 });
    expect(again.status).toBe(409);
  });

  it("refuses to open an OS when the e-mail has no Manager user", async () => {
    const { agent, ticket } = await setup("sem-manager@connect.com");
    const res = await request(app).post(`/api/tickets/${ticket.id}/manager/os`).set("Authorization", bearer(agent)).send({ titulo: "x", codCliente: 123 });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Manager/);
    expect((await Ticket.findByPk(ticket.id))?.managerOsId).toBeNull();
  });

  it("registers the atendimento once, with the ticket dates", async () => {
    const { agent, ticket } = await setup();
    const res = await request(app)
      .post(`/api/tickets/${ticket.id}/manager/atendimento`)
      .set("Authorization", bearer(agent))
      .send({ codCliente: 123, codProduto: 7, descricao: "Reconfigurada a impressora." });
    expect(res.status).toBe(201);
    expect(res.body.managerAtendimentoId).toBe(5678);
    const sent = JSON.parse(String(calls.find((c) => c.url.endsWith("/atendimentos/"))?.init?.body));
    expect(sent).toMatchObject({ cod_tecnico: 3, cod_produto: 7, ticket_id: ticket.id });
    expect(sent.dt_abertura).toBe(ticket.createdAt.toISOString());

    const again = await request(app).post(`/api/tickets/${ticket.id}/manager/atendimento`).set("Authorization", bearer(agent)).send({ codCliente: 123, descricao: "x" });
    expect(again.status).toBe(409);
  });

  it("rejects atendimento descriptions above 500 characters and passes Manager errors through", async () => {
    const { agent, ticket } = await setup();
    const long = await request(app).post(`/api/tickets/${ticket.id}/manager/atendimento`).set("Authorization", bearer(agent)).send({ codCliente: 123, descricao: "a".repeat(501) });
    expect(long.status).toBe(400);

    fetchMock.mockImplementation(async (input) =>
      String(input).includes("/catalogos/") ? json(200, catalog) : json(400, { erro: "Cliente inválido" }),
    );
    const res = await request(app).post(`/api/tickets/${ticket.id}/manager/os`).set("Authorization", bearer(agent)).send({ titulo: "x", codCliente: 999 });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe("Cliente inválido");
  });

  it("answers 502 when the Manager is unreachable", async () => {
    const { agent, ticket } = await setup();
    fetchMock.mockImplementation(async (input) => {
      if (String(input).includes("/catalogos/")) return json(200, catalog);
      throw new Error("ECONNREFUSED");
    });
    const res = await request(app).post(`/api/tickets/${ticket.id}/manager/os`).set("Authorization", bearer(agent)).send({ titulo: "x", codCliente: 123 });
    expect(res.status).toBe(502);
  });
});
