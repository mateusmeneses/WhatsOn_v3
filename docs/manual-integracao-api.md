# Manual técnico de integração — API WhatsOn

Guia para integrar **qualquer sistema** (ERP, e-commerce, CRM, BI, automações, scripts) ao WhatsOn:
conectar um número de WhatsApp e enviar mensagens por ele.

> No painel do WhatsOn há a página **Integração API** (menu `{ }`, só admin) com este manual,
> a referência das rotas, um **console de testes** e exemplos prontos em várias linguagens.
> Referência curta das rotas: [api-externa.md](api-externa.md).

---

## 1. Visão geral

```
┌──────────────────┐   HTTPS + Bearer token   ┌───────────────┐    ┌──────────────┐
│ Seu sistema      │ ───────────────────────▶ │ WhatsOn       │ ─▶ │ WhatsApp     │
│ (ERP, loja, ...) │ ◀─────── JSON ────────── │ /api/v1       │    │ (número)     │
└──────────────────┘                          └───────┬───────┘    └──────────────┘
                                                      │ histórico / atendimento
                                                      ▼
                                              Painel WhatsOn (equipe)
```

- API REST sobre HTTPS, JSON em UTF-8.
- Um **token por conexão** (número de WhatsApp). Tudo que é feito com o token usa aquele número.
- Toda mensagem enviada entra no **atendimento do contato** e aparece no histórico do painel, como se um
  atendente tivesse enviado. As respostas do cliente chegam no painel e a equipe atende normalmente.
- O envio é **assíncrono**: a API aceita e registra a mensagem (HTTP 201) e a entrega ao WhatsApp ocorre em
  seguida, por fila.

## 2. Pré-requisitos

| Item | Onde obter |
|---|---|
| URL do WhatsOn | A mesma do painel. A API fica em `https://<seu-whatson>/api/v1`. |
| Token de API | Painel → **Conexões** → botão da chave (🔑) → **Gerar token** (perfil admin). |
| Número conectado | Leitura do QR code pelo painel ou pela própria API (seção 5). |
| Cliente HTTP com TLS | Qualquer linguagem moderna. Para Delphi antigo, use Indy com OpenSSL 1.1+ ou `THTTPClient` (XE8+). |

Ambiente de homologação (quando disponível): `https://hmlwhatson.connectmulti.com.br/api/v1`, com token próprio.
Nunca use o token de produção em homologação, nem o contrário.

## 3. Autenticação

Todas as requisições levam o cabeçalho:

```
Authorization: Bearer <TOKEN>
```

| Situação | HTTP | `error.code` |
|---|---|---|
| Cabeçalho ausente | 401 | `UNAUTHENTICATED` |
| Token inexistente ou regenerado | 403 | `INVALID_API_TOKEN` |
| Empresa bloqueada | 403 | `COMPANY_BLOCKED` |

- O login do painel (JWT) e o token de webhook da conexão **não** valem nesta API.
- **Regenerar** o token no painel invalida o anterior imediatamente.
- O token não expira sozinho.

## 4. Convenções

- **Requisição:** `Content-Type: application/json` (ou `multipart/form-data` para arquivos).
- **Resposta de sucesso:** JSON; `200` nas consultas e `201` nos envios.
- **Resposta de erro:** sempre no formato

  ```json
  { "error": { "code": "CODIGO_ESTAVEL", "message": "Texto para humanos" } }
  ```

  Programe sempre pelo `code` (estável); a `message` pode mudar.
- **Timeout recomendado no cliente:** 30 s (60 s para upload de arquivos grandes).
- **Telefones** (campo `number`): aceita qualquer formatação — `(11) 98888-7777`, `+55 11 98888-7777`,
  `5511988887777`. Ficam só os dígitos; com 10 ou 11 dígitos (DDD + número) o DDI `55` é adicionado.
  Números de outros países devem vir com o DDI. Entre 12 e 15 dígitos após a normalização.
- O número gravado é o que o WhatsApp devolve (há linhas sem o nono dígito), por isso o `number` da resposta pode
  diferir do enviado. Use-o se quiser guardar o "número WhatsApp" do cliente.

## 5. Conectar o número

Estados da conexão: `disconnected` → `qrcode` → `connected`.

```
GET /connection/status
  ├─ connected  → pronto para enviar
  └─ outro      → GET /connection/qrcode → mostre a imagem
                  repita a cada ~20 s até status = connected (timeout ~2 min)
```

### 5.1 Status

```bash
curl -s https://<seu-whatson>/api/v1/connection/status -H "Authorization: Bearer $TOKEN"
```

```json
{ "status": "connected", "number": "5511999990000" }
```

### 5.2 QR code

```bash
curl -s https://<seu-whatson>/api/v1/connection/qrcode -H "Authorization: Bearer $TOKEN"
```

```json
{ "qrcode": "data:image/png;base64,iVBORw0KGgo...", "status": "qrcode" }
```

- `qrcode` é um *data URL*: use direto como `src` de `<img>`, ou decodifique o trecho após `base64,` para PNG.
- O QR expira em segundos; peça de novo enquanto o status não for `connected`.
- Com o número já conectado retorna `{ "qrcode": null, "status": "connected" }`.
- No celular: WhatsApp → **Aparelhos conectados** → **Conectar um aparelho**.

### 5.3 Desconectar

```bash
curl -s -X POST https://<seu-whatson>/api/v1/connection/logout -H "Authorization: Bearer $TOKEN"
```

```json
{ "status": "disconnected" }
```

## 6. Enviar mensagens

### 6.1 Texto

```bash
curl -s -X POST https://<seu-whatson>/api/v1/messages/send \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"number":"5511988887777","body":"Olá! Seu pedido 1234 saiu para entrega."}'
```

Resposta `201`:

```json
{
  "ticketId": 42,
  "contactId": 17,
  "number": "5511988887777",
  "messages": [{ "id": 901, "type": "text", "ack": "pending" }]
}
```

| Campo | Uso |
|---|---|
| `ticketId` | Atendimento onde a mensagem entrou (aberto existente ou novo). |
| `contactId` | Contato no WhatsOn. |
| `number` | Número como o WhatsApp o reconhece. |
| `messages[].id` | Id da mensagem no WhatsOn — guarde para rastrear. |
| `messages[].ack` | `pending` na criação; depois `sent` → `delivered` → `read` (ou `failed`), visível no painel. |

### 6.2 Arquivos (multipart)

Campo `medias` (até **10 arquivos de 16 MB**). `body` vira a legenda do **primeiro** arquivo.
Cada arquivo gera uma mensagem em `messages[]`. O tipo (imagem, áudio, vídeo, documento) é deduzido do
`Content-Type` de cada parte — envie o MIME correto (`application/pdf`, `image/jpeg`...).

```bash
curl -s -X POST https://<seu-whatson>/api/v1/messages/send \
  -H "Authorization: Bearer $TOKEN" \
  -F "number=5511988887777" -F "body=Segue o boleto" \
  -F "medias=@boleto.pdf;type=application/pdf"
```

### 6.3 Arquivo por URL

Quando o arquivo já está publicado (ex.: link do boleto ou da NF-e):

```bash
curl -s -X POST https://<seu-whatson>/api/v1/messages/send-media-url \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"number":"5511988887777","url":"https://exemplo.com/nf/1234.pdf","caption":"NF-e 1234","fileName":"NF-1234.pdf"}'
```

- Só `http`/`https` **públicos** (endereços internos como `localhost`, `10.x`, `192.168.x` são recusados).
- Até 16 MB e 3 redirecionamentos. A URL precisa abrir sem login.
- O tipo vem do `Content-Type` devolvido pelo servidor da URL.

### 6.4 Verificar número (sem enviar)

```bash
curl -s -X POST https://<seu-whatson>/api/v1/contacts/check \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"number":"5531988887777"}'
```

```json
{ "exists": true, "jid": "553188887777@s.whatsapp.net" }
```

Bom para validar o cadastro do cliente. Não é necessário antes de cada envio: o `/messages/send` já verifica.

## 7. Erros e política de repetição

| HTTP | `error.code` | Causa | Repetir? | Ação recomendada |
|---|---|---|---|---|
| 400 | `VALIDATION_ERROR` | Campo ausente/inválido | Não | Corrigir payload |
| 400 | `INVALID_PHONE` | Telefone com dígitos insuficientes/excesso | Não | Revisar cadastro |
| 400 | `INVALID_MEDIA_URL` | URL inválida ou interna | Não | Usar URL pública |
| 400 | `MEDIA_DOWNLOAD_FAILED` | URL inacessível | Não* | Verificar a URL |
| 400 | `MEDIA_TOO_LARGE` / `UPLOAD_ERROR` | Arquivo acima do limite / campo errado | Não | Reduzir / usar `medias` |
| 401 | `UNAUTHENTICATED` | Sem token | Não | Configurar o cabeçalho |
| 403 | `INVALID_API_TOKEN` | Token errado/regenerado | Não | Alertar o administrador |
| 403 | `COMPANY_BLOCKED` | Empresa bloqueada | Não | Contatar o suporte |
| 404 | `NUMBER_NOT_ON_WHATSAPP` | Destinatário sem WhatsApp | Não | Marcar o contato |
| 409 | `CONNECTION_NOT_CONNECTED` | Número desconectado | Sim, após reconectar | Alertar para ler o QR |
| 429 | `RATE_LIMITED` | Limite por minuto | Sim | Esperar `Retry-After` |
| 500 | `INTERNAL_ERROR` | Erro inesperado | Sim | Backoff |
| 502 | `PROVIDER_ERROR` | Falha temporária do WhatsApp | Sim | Backoff |
| — | (timeout / rede) | Sem resposta | Com cuidado | Ver seção 9 |

\* Repita só se o problema for temporário no servidor da URL.

**Backoff recomendado:** 2 s, 4 s, 8 s, 16 s, 32 s (máx. 5 tentativas), com variação aleatória de ±20%.
Em `429`, espere exatamente os segundos de `Retry-After`.

## 8. Limites

| Limite | Valor |
|---|---|
| Requisições por token | 60/min (padrão; janela fixa de 1 minuto) |
| Texto (`body`) | 4096 caracteres |
| Legenda (`caption`) | 1024 caracteres |
| Arquivos por envio | 10 |
| Tamanho por arquivo | 16 MB |

Cabeçalhos em toda resposta autenticada: `X-RateLimit-Limit`, `X-RateLimit-Remaining`; no `429`, `Retry-After`.

**Envios em massa:** o WhatsApp pode banir números que disparam rápido para muitos contatos. Use uma fila no
seu sistema e espace os envios (ex.: 1 mensagem a cada 1–3 s, variando), priorize contatos que já conversaram
com a empresa e evite conteúdo repetido idêntico.

## 9. Duplicidade (idempotência)

A API **não** tem chave de idempotência. Uma repetição após o servidor já ter aceitado gera mensagem duplicada.

- Repita automaticamente só quando houver **resposta** de erro repetível (tabela da seção 7).
- Em **timeout sem resposta**, marque o envio como "incerto" e confira no painel antes de reenviar, ou aceite o
  risco de duplicar em mensagens não críticas.
- Guarde `messages[].id` de cada envio aceito para não reenviar o mesmo item da sua fila.

## 10. Segurança

- O token dá controle total do número. Guarde-o **só no servidor** do sistema integrado (variável de ambiente,
  cofre de segredos, tabela de configuração com acesso restrito). Nunca em app, JavaScript de navegador, planilha
  ou repositório de código.
- Sempre HTTPS. Não registre o token em logs (mascare: `abcd…wxyz`).
- Se vazar, **regenere** no painel e atualize o sistema; o token antigo para na hora.
- Prefira uma conexão (e um token) por sistema integrado.

## 11. Arquitetura recomendada no seu sistema

```
Evento de negócio (pedido faturado, boleto gerado...)
        │
        ▼
Tabela/fila de saída  ──▶  Worker de envio  ──▶  WhatsOn /api/v1
(status: pendente)          │  respeita 60/min        │
                            │  backoff em 429/5xx     │
                            ▼                         ▼
                    atualiza status: enviado / erro_definitivo / incerto
```

Tabela sugerida para o log de envios:

```sql
CREATE TABLE whatson_envios (
  id               BIGINT PRIMARY KEY,
  referencia       VARCHAR(60)  NOT NULL,          -- ex.: "pedido:1234"
  telefone         VARCHAR(20)  NOT NULL,
  texto            TEXT,
  arquivo_url      VARCHAR(500),
  status           VARCHAR(20)  NOT NULL DEFAULT 'pendente', -- pendente|enviado|erro|incerto
  tentativas       INT          NOT NULL DEFAULT 0,
  proxima_tentativa TIMESTAMP,
  whatson_msg_id   BIGINT,                          -- messages[0].id
  whatson_ticket_id BIGINT,
  erro_codigo      VARCHAR(40),
  erro_mensagem    VARCHAR(500),
  criado_em        TIMESTAMP    NOT NULL,
  enviado_em       TIMESTAMP,
  UNIQUE (referencia, telefone)                     -- evita enfileirar o mesmo envio duas vezes
);
```

Pseudocódigo do worker:

```
para cada envio pendente com proxima_tentativa <= agora (ordem de criação):
    resp = POST /messages/send
    se resp.status == 201:
        status = enviado; whatson_msg_id = resp.messages[0].id
    senão se resp.code em (RATE_LIMITED):
        proxima_tentativa = agora + Retry-After
    senão se resp.code em (PROVIDER_ERROR, INTERNAL_ERROR, CONNECTION_NOT_CONNECTED) e tentativas < 5:
        tentativas += 1; proxima_tentativa = agora + 2^tentativas s
        se CONNECTION_NOT_CONNECTED: alertar o administrador (ler QR)
    senão se sem resposta (timeout):
        status = incerto
    senão:
        status = erro; erro_codigo = resp.code   # não repetir
    se resp.code == INVALID_API_TOKEN: parar o worker e alertar
    aguardar 1–3 s
```

## 12. Clientes de referência

Implementações mínimas com tratamento de erro. Ajuste `BASE_URL` e leia o token de um local seguro.

### 12.1 Node.js 18+ / TypeScript

```ts
export class WhatsOnError extends Error {
  constructor(public status: number, public code: string, message: string, public retryAfter?: number) {
    super(message);
  }
}

export class WhatsOnClient {
  constructor(private baseUrl: string, private token: string) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const isForm = body instanceof FormData;
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, ...(body && !isForm ? { "Content-Type": "application/json" } : {}) },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const retryAfter = Number(res.headers.get("retry-after")) || undefined;
      throw new WhatsOnError(res.status, data?.error?.code ?? "HTTP_ERROR", data?.error?.message ?? res.statusText, retryAfter);
    }
    return data as T;
  }

  status() { return this.request<{ status: string; number: string | null }>("GET", "/connection/status"); }
  qrcode() { return this.request<{ qrcode: string | null; status: string }>("GET", "/connection/qrcode"); }
  logout() { return this.request<{ status: string }>("POST", "/connection/logout"); }
  check(number: string) { return this.request<{ exists: boolean; jid: string | null }>("POST", "/contacts/check", { number }); }
  sendText(number: string, body: string) { return this.request("POST", "/messages/send", { number, body }); }
  sendMediaUrl(number: string, url: string, caption?: string, fileName?: string) {
    return this.request("POST", "/messages/send-media-url", { number, url, caption, fileName });
  }
  sendFiles(number: string, files: { name: string; data: Blob }[], body?: string) {
    const form = new FormData();
    form.append("number", number);
    if (body) form.append("body", body);
    for (const f of files) form.append("medias", f.data, f.name);
    return this.request("POST", "/messages/send", form);
  }
}

// Uso
const whatson = new WhatsOnClient("https://<seu-whatson>/api/v1", process.env.WHATSON_TOKEN!);
await whatson.sendText("11988887777", "Pedido 1234 faturado");
```

### 12.2 PHP 7.4+

```php
<?php
final class WhatsOnClient
{
    public function __construct(private string $baseUrl, private string $token) {}

    private function request(string $method, string $path, $body = null, bool $multipart = false): array
    {
        $ch = curl_init($this->baseUrl . $path);
        $headers = ["Authorization: Bearer {$this->token}"];
        if ($body !== null && !$multipart) {
            $headers[] = 'Content-Type: application/json';
            $body = json_encode($body);
        }
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 30,
            CURLOPT_HTTPHEADER => $headers,
        ] + ($body !== null ? [CURLOPT_POSTFIELDS => $body] : []));
        $raw = curl_exec($ch);
        if ($raw === false) throw new RuntimeException('Sem resposta: ' . curl_error($ch));
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        $data = json_decode($raw, true) ?? [];
        if ($status >= 400) {
            throw new RuntimeException(($data['error']['code'] ?? 'HTTP_ERROR') . ': ' . ($data['error']['message'] ?? $raw), $status);
        }
        return $data;
    }

    public function status(): array { return $this->request('GET', '/connection/status'); }
    public function qrcode(): array { return $this->request('GET', '/connection/qrcode'); }
    public function check(string $number): array { return $this->request('POST', '/contacts/check', ['number' => $number]); }
    public function sendText(string $number, string $body): array
    { return $this->request('POST', '/messages/send', ['number' => $number, 'body' => $body]); }
    public function sendFile(string $number, string $path, string $mime, ?string $caption = null): array
    {
        $form = ['number' => $number, 'medias[]' => new CURLFile($path, $mime, basename($path))];
        if ($caption) $form['body'] = $caption;
        return $this->request('POST', '/messages/send', $form, true);
    }
}
```

### 12.3 Python 3

```python
import requests

class WhatsOnError(Exception):
    def __init__(self, status, code, message, retry_after=None):
        super().__init__(f"{status} {code}: {message}")
        self.status, self.code, self.retry_after = status, code, retry_after

class WhatsOnClient:
    def __init__(self, base_url: str, token: str):
        self.base_url = base_url.rstrip("/")
        self.s = requests.Session()
        self.s.headers["Authorization"] = f"Bearer {token}"

    def _req(self, method, path, **kw):
        res = self.s.request(method, self.base_url + path, timeout=30, **kw)
        data = res.json() if res.content else {}
        if not res.ok:
            err = data.get("error", {})
            raise WhatsOnError(res.status_code, err.get("code", "HTTP_ERROR"), err.get("message", res.text),
                               res.headers.get("Retry-After"))
        return data

    def status(self): return self._req("GET", "/connection/status")
    def qrcode(self): return self._req("GET", "/connection/qrcode")
    def check(self, number): return self._req("POST", "/contacts/check", json={"number": number})
    def send_text(self, number, body): return self._req("POST", "/messages/send", json={"number": number, "body": body})
    def send_file(self, number, path, mime, caption=None):
        with open(path, "rb") as f:
            return self._req("POST", "/messages/send", data={"number": number, "body": caption or ""},
                             files=[("medias", (path.split("/")[-1], f, mime))])
```

### 12.4 C# (.NET 6+)

```csharp
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

public sealed class WhatsOnException(int status, string code, string message) : Exception($"{status} {code}: {message}")
{
    public int Status { get; } = status;
    public string Code { get; } = code;
}

public sealed class WhatsOnClient
{
    private readonly HttpClient _http;

    public WhatsOnClient(string baseUrl, string token)
    {
        _http = new HttpClient { BaseAddress = new Uri(baseUrl.TrimEnd('/') + "/"), Timeout = TimeSpan.FromSeconds(30) };
        _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
    }

    private static async Task<JsonElement> Read(HttpResponseMessage res)
    {
        var json = await res.Content.ReadFromJsonAsync<JsonElement>();
        if (!res.IsSuccessStatusCode)
        {
            var err = json.GetProperty("error");
            throw new WhatsOnException((int)res.StatusCode, err.GetProperty("code").GetString()!, err.GetProperty("message").GetString()!);
        }
        return json;
    }

    public async Task<JsonElement> StatusAsync() => await Read(await _http.GetAsync("connection/status"));
    public async Task<JsonElement> QrCodeAsync() => await Read(await _http.GetAsync("connection/qrcode"));
    public async Task<JsonElement> CheckAsync(string number) =>
        await Read(await _http.PostAsJsonAsync("contacts/check", new { number }));
    public async Task<JsonElement> SendTextAsync(string number, string body) =>
        await Read(await _http.PostAsJsonAsync("messages/send", new { number, body }));

    public async Task<JsonElement> SendFileAsync(string number, string path, string mime, string? caption = null)
    {
        using var form = new MultipartFormDataContent { { new StringContent(number), "number" } };
        if (caption != null) form.Add(new StringContent(caption), "body");
        var file = new ByteArrayContent(await File.ReadAllBytesAsync(path));
        file.Headers.ContentType = new MediaTypeHeaderValue(mime);
        form.Add(file, "medias", Path.GetFileName(path));
        return await Read(await _http.PostAsync("messages/send", form));
    }
}
```

### 12.5 Java 11+

```java
import java.net.URI;
import java.net.http.*;
import java.time.Duration;

public final class WhatsOnClient {
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    private final String baseUrl, token;

    public WhatsOnClient(String baseUrl, String token) { this.baseUrl = baseUrl; this.token = token; }

    private String send(HttpRequest.Builder b) throws Exception {
        HttpResponse<String> res = http.send(
            b.header("Authorization", "Bearer " + token).timeout(Duration.ofSeconds(30)).build(),
            HttpResponse.BodyHandlers.ofString());
        if (res.statusCode() >= 400) throw new RuntimeException(res.statusCode() + " " + res.body());
        return res.body(); // parse com Jackson/Gson
    }

    private String postJson(String path, String json) throws Exception {
        return send(HttpRequest.newBuilder(URI.create(baseUrl + path))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(json)));
    }

    public String status() throws Exception { return send(HttpRequest.newBuilder(URI.create(baseUrl + "/connection/status")).GET()); }
    public String qrcode() throws Exception { return send(HttpRequest.newBuilder(URI.create(baseUrl + "/connection/qrcode")).GET()); }
    // Gson (com.google.code.gson) escapa os textos corretamente
    private final com.google.gson.Gson gson = new com.google.gson.Gson();

    public String sendText(String number, String body) throws Exception {
        return postJson("/messages/send", gson.toJson(java.util.Map.of("number", number, "body", body)));
    }
    public String sendMediaUrl(String number, String url, String caption) throws Exception {
        return postJson("/messages/send-media-url", gson.toJson(java.util.Map.of("number", number, "url", url, "caption", caption)));
    }
}
```

Para multipart em Java, use OkHttp (`MultipartBody`) ou envie por URL com `/messages/send-media-url`.

### 12.6 Delphi (XE8+ com `THTTPClient`)

```pascal
unit WhatsOnClient;

interface

uses System.SysUtils, System.Classes, System.JSON, System.Net.HttpClient, System.Net.Mime;

type
  EWhatsOn = class(Exception)
  public
    Status: Integer;
    Code: string;
  end;

  TWhatsOnClient = class
  private
    FBaseUrl, FToken: string;
    function NewClient: THTTPClient;
    function Handle(const Res: IHTTPResponse): TJSONObject;
  public
    constructor Create(const ABaseUrl, AToken: string);
    function Status: TJSONObject;
    function QrCode: TJSONObject;
    function SendText(const ANumber, ABody: string): TJSONObject;
    function SendFile(const ANumber, AFileName, ACaption: string): TJSONObject;
  end;

implementation

constructor TWhatsOnClient.Create(const ABaseUrl, AToken: string);
begin
  FBaseUrl := ABaseUrl;
  FToken := AToken;
end;

function TWhatsOnClient.NewClient: THTTPClient;
begin
  Result := THTTPClient.Create;
  Result.CustomHeaders['Authorization'] := 'Bearer ' + FToken;
  Result.ResponseTimeout := 30000;
end;

function TWhatsOnClient.Handle(const Res: IHTTPResponse): TJSONObject;
var
  E: EWhatsOn;
  Err: TJSONObject;
begin
  Result := TJSONObject.ParseJSONValue(Res.ContentAsString(TEncoding.UTF8)) as TJSONObject;
  if Res.StatusCode >= 400 then
  begin
    Err := Result.GetValue('error') as TJSONObject;
    E := EWhatsOn.Create(Err.GetValue<string>('message'));
    E.Status := Res.StatusCode;
    E.Code := Err.GetValue<string>('code');
    Result.Free;
    raise E;
  end;
end;

function TWhatsOnClient.Status: TJSONObject;
var C: THTTPClient;
begin
  C := NewClient;
  try Result := Handle(C.Get(FBaseUrl + '/connection/status')); finally C.Free; end;
end;

function TWhatsOnClient.QrCode: TJSONObject;
var C: THTTPClient;
begin
  C := NewClient;
  try Result := Handle(C.Get(FBaseUrl + '/connection/qrcode')); finally C.Free; end;
end;

function TWhatsOnClient.SendText(const ANumber, ABody: string): TJSONObject;
var
  C: THTTPClient;
  Payload: TJSONObject;
  Body: TStringStream;
begin
  C := NewClient;
  Payload := TJSONObject.Create;
  try
    Payload.AddPair('number', ANumber).AddPair('body', ABody);
    Body := TStringStream.Create(Payload.ToJSON, TEncoding.UTF8);
    try
      C.ContentType := 'application/json';
      Result := Handle(C.Post(FBaseUrl + '/messages/send', Body));
    finally
      Body.Free;
    end;
  finally
    Payload.Free;
    C.Free;
  end;
end;

function TWhatsOnClient.SendFile(const ANumber, AFileName, ACaption: string): TJSONObject;
var
  C: THTTPClient;
  Form: TMultipartFormData;
begin
  C := NewClient;
  Form := TMultipartFormData.Create;
  try
    Form.AddField('number', ANumber);
    if ACaption <> '' then Form.AddField('body', ACaption);
    Form.AddFile('medias', AFileName);
    Result := Handle(C.Post(FBaseUrl + '/messages/send', Form));
  finally
    Form.Free;
    C.Free;
  end;
end;

end.
```

Uso:

```pascal
var
  W: TWhatsOnClient;
  R: TJSONObject;
begin
  W := TWhatsOnClient.Create('https://<seu-whatson>/api/v1', TokenDaConfiguracao);
  try
    R := W.SendText('11988887777', 'Pedido 1234 faturado');
    try
      ShowMessage('Mensagem ' + R.GetValue<string>('messages[0].id'));
    finally
      R.Free;
    end;
  finally
    W.Free;
  end;
end;
```

O QR (`qrcode`) vem como `data:image/png;base64,...`: decodifique a parte após `base64,` com
`TNetEncoding.Base64.DecodeStringToBytes` e carregue num `TPngImage` para exibir num `TImage`.

## 13. Homologação (checklist)

- [ ] `GET /connection/status` retorna `connected` com o token de homologação.
- [ ] Texto chega no celular e aparece no histórico do WhatsOn.
- [ ] PDF e imagem (multipart **e** por URL) chegam com legenda e nome corretos.
- [ ] Número sem WhatsApp → `NUMBER_NOT_ON_WHATSAPP`, sem novas tentativas.
- [ ] Token inválido → `403`, sistema alerta o administrador e para a fila.
- [ ] `429` respeita `Retry-After`; `502` repete com backoff; os demais não repetem.
- [ ] Número desconectado (`409`) gera alerta para ler o QR code.
- [ ] Timeout sem resposta vira "incerto", sem reenvio automático.
- [ ] Token fora de logs, do navegador do usuário final e do repositório.
- [ ] Envios em lote espaçados (1–3 s).

O console de testes da página **Integração API** permite executar cada rota com o token real e copiar o cURL
equivalente — útil para comparar com o que seu sistema envia.

## 14. Solução de problemas

| Sintoma | Causa provável | Como resolver |
|---|---|---|
| `401` sempre | Cabeçalho sem `Bearer ` ou removido por proxy | Envie `Authorization: Bearer <token>` exatamente |
| `403 INVALID_API_TOKEN` após funcionar | Token regenerado no painel | Atualize o token no sistema |
| `409 CONNECTION_NOT_CONNECTED` | Celular desconectou o aparelho / sem internet | Leia novo QR (painel ou `/connection/qrcode`) |
| `404 NUMBER_NOT_ON_WHATSAPP` com número válido | DDD/DDI errado | Confira com `/contacts/check` |
| Mensagem `pending` por muito tempo | Fila do WhatsOn ou WhatsApp lento | Aguarde; vira `failed` se esgotar tentativas |
| Mensagem `failed` no painel | Falha definitiva no WhatsApp | Reenvie pelo painel ou pela API |
| Arquivo chega como "documento" | `Content-Type` genérico | Envie o MIME correto do arquivo |
| `MEDIA_DOWNLOAD_FAILED` | URL exige login, expirou ou é interna | Publique o arquivo numa URL pública temporária |
| Erro de TLS em sistemas antigos | Cliente sem TLS 1.2 | Atualize a biblioteca SSL (OpenSSL 1.1+) |

## 15. Migração do Whatson antigo

| Whatson antigo | WhatsOn `/api/v1` |
|---|---|
| `POST /api/messages/send` (multipart `medias`) | `POST /api/v1/messages/send` (JSON ou multipart `medias`) |
| `POST /api/messages/send/linkImage` | `POST /api/v1/messages/send-media-url` (qualquer tipo de arquivo) |
| `POST /api/messages/checkNumber` | `POST /api/v1/contacts/check` |
| — | `GET /api/v1/connection/status`, `GET /api/v1/connection/qrcode`, `POST /api/v1/connection/logout` |

O cabeçalho continua `Authorization: Bearer <token>`, mas o token é **novo** (gerado em Conexões) e a URL base
muda para `/api/v1`. Os erros agora vêm em `{ "error": { "code", "message" } }`.

## 16. Referência rápida

| Método | Rota | Corpo | Sucesso |
|---|---|---|---|
| GET | `/connection/status` | — | `200 { status, number }` |
| GET | `/connection/qrcode` | — | `200 { qrcode, status }` |
| POST | `/connection/logout` | — | `200 { status }` |
| POST | `/messages/send` | `{ number, body }` ou multipart `number, body, medias[]` | `201 { ticketId, contactId, number, messages[] }` |
| POST | `/messages/send-media-url` | `{ number, url, caption?, fileName? }` | `201 { ticketId, contactId, number, messages[] }` |
| POST | `/contacts/check` | `{ number }` | `200 { exists, jid }` |
