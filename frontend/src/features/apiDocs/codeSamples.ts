import type { EndpointSpec } from "./endpoints";

export type Language = "curl" | "javascript" | "php" | "python" | "csharp" | "java" | "delphi";

export const LANGUAGES: { value: Language; label: string }[] = [
  { value: "curl", label: "cURL" },
  { value: "javascript", label: "JavaScript / Node" },
  { value: "php", label: "PHP" },
  { value: "python", label: "Python" },
  { value: "csharp", label: "C# (.NET)" },
  { value: "java", label: "Java" },
  { value: "delphi", label: "Delphi" },
];

export interface SampleInput {
  baseUrl: string;
  token: string;
  payload: Record<string, string>;
  /** Envia um arquivo no campo medias (só /messages/send). */
  withFile?: boolean;
}

const FILE = "boleto.pdf";

const json = (payload: Record<string, string>, indent = 2) => JSON.stringify(payload, null, indent);
const shellQuote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
const cString = (s: string) => JSON.stringify(s);
const pascal = (s: string) => `'${s.replace(/'/g, "''")}'`;

function curl(e: EndpointSpec, { baseUrl, token, payload, withFile }: SampleInput): string {
  const lines = [`curl -X ${e.method} "${baseUrl}${e.path}"`, `  -H "Authorization: Bearer ${token}"`];
  if (withFile) {
    for (const [k, v] of Object.entries(payload)) lines.push(`  -F ${shellQuote(`${k}=${v}`)}`);
    lines.push(`  -F "medias=@${FILE}"`);
  } else if (e.body !== "none") {
    lines.push(`  -H "Content-Type: application/json"`, `  -d ${shellQuote(JSON.stringify(payload))}`);
  }
  return lines.join(" \\\n");
}

function javascript(e: EndpointSpec, { baseUrl, token, payload, withFile }: SampleInput): string {
  const head = `const BASE_URL = "${baseUrl}";\nconst TOKEN = "${token}";\n\n`;
  if (withFile) {
    const appends = Object.entries(payload)
      .map(([k, v]) => `form.append(${cString(k)}, ${cString(v)});`)
      .join("\n");
    return `${head}// Node 18+: import { openAsBlob } from "node:fs";  |  Navegador: use o File de um <input type="file">
const form = new FormData();
${appends}
form.append("medias", await openAsBlob("${FILE}"), "${FILE}");

const res = await fetch(\`\${BASE_URL}${e.path}\`, {
  method: "POST",
  headers: { Authorization: \`Bearer \${TOKEN}\` }, // não defina Content-Type: o fetch monta o boundary
  body: form,
});
const data = await res.json();
if (!res.ok) throw new Error(\`\${res.status} \${data.error.code}: \${data.error.message}\`);
console.log(data);`;
  }
  const body =
    e.body === "none"
      ? ""
      : `\n  body: JSON.stringify(${json(payload).replace(/\n/g, "\n  ")}),`;
  const contentType = e.body === "none" ? "" : `, "Content-Type": "application/json"`;
  return `${head}const res = await fetch(\`\${BASE_URL}${e.path}\`, {
  method: "${e.method}",
  headers: { Authorization: \`Bearer \${TOKEN}\`${contentType} },${body}
});
const data = await res.json();
if (!res.ok) throw new Error(\`\${res.status} \${data.error.code}: \${data.error.message}\`);
console.log(data);`;
}

function php(e: EndpointSpec, { baseUrl, token, payload, withFile }: SampleInput): string {
  const phpArray = (p: Record<string, string>) =>
    `[\n${Object.entries(p)
      .map(([k, v]) => `    ${cString(k)} => ${cString(v)},`)
      .join("\n")}${withFile ? `\n    "medias[]" => new CURLFile("${FILE}"),` : ""}\n]`;
  let opts = "";
  if (withFile) {
    opts = `    CURLOPT_POSTFIELDS => ${phpArray(payload).replace(/\n/g, "\n    ")},\n`;
  } else if (e.body !== "none") {
    opts = `    CURLOPT_POSTFIELDS => json_encode(${phpArray(payload).replace(/\n/g, "\n    ")}),\n`;
  }
  const headers = withFile || e.body === "none" ? `["Authorization: Bearer $token"]` : `["Authorization: Bearer $token", "Content-Type: application/json"]`;
  return `<?php
$baseUrl = "${baseUrl}";
$token = "${token}";

$ch = curl_init("$baseUrl${e.path}");
curl_setopt_array($ch, [
    CURLOPT_CUSTOMREQUEST => "${e.method}",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 30,
    CURLOPT_HTTPHEADER => ${headers},
${opts}]);
$response = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

$data = json_decode($response, true);
if ($status >= 400) {
    throw new Exception("$status {$data['error']['code']}: {$data['error']['message']}");
}
print_r($data);`;
}

function python(e: EndpointSpec, { baseUrl, token, payload, withFile }: SampleInput): string {
  const dict = `{${Object.entries(payload)
    .map(([k, v]) => `${cString(k)}: ${cString(v)}`)
    .join(", ")}}`;
  let call: string;
  if (withFile) {
    call = `with open("${FILE}", "rb") as f:
    res = requests.post(
        f"{BASE_URL}${e.path}",
        headers=HEADERS,
        data=${dict},
        files=[("medias", ("${FILE}", f))],
        timeout=30,
    )`;
  } else {
    const arg = e.body === "none" ? "" : `, json=${dict}`;
    call = `res = requests.${e.method.toLowerCase()}(f"{BASE_URL}${e.path}", headers=HEADERS${arg}, timeout=30)`;
  }
  return `import requests  # pip install requests

BASE_URL = "${baseUrl}"
HEADERS = {"Authorization": "Bearer ${token}"}

${call}
data = res.json()
if not res.ok:
    raise RuntimeError(f"{res.status_code} {data['error']['code']}: {data['error']['message']}")
print(data)`;
}

function csharp(e: EndpointSpec, { baseUrl, token, payload, withFile }: SampleInput): string {
  let content = "";
  if (withFile) {
    const parts = Object.entries(payload)
      .map(([k, v]) => `form.Add(new StringContent(${cString(v)}), ${cString(k)});`)
      .join("\n");
    content = `using var form = new MultipartFormDataContent();
${parts}
var file = new ByteArrayContent(await File.ReadAllBytesAsync("${FILE}"));
file.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
form.Add(file, "medias", "${FILE}");
var res = await http.PostAsync("${e.path.slice(1)}", form);`;
  } else if (e.body === "none") {
    content = `var res = await http.${e.method === "GET" ? "GetAsync" : "PostAsync"}("${e.path.slice(1)}"${e.method === "POST" ? ", null" : ""});`;
  } else {
    const anon = Object.entries(payload)
      .map(([k, v]) => `${k} = ${cString(v)}`)
      .join(", ");
    content = `var res = await http.PostAsJsonAsync("${e.path.slice(1)}", new { ${anon} });`;
  }
  return `using System.Net.Http.Headers;
using System.Net.Http.Json;

using var http = new HttpClient { BaseAddress = new Uri("${baseUrl}/"), Timeout = TimeSpan.FromSeconds(30) };
http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "${token}");

${content}
var body = await res.Content.ReadAsStringAsync();
if (!res.IsSuccessStatusCode) throw new Exception($"{(int)res.StatusCode}: {body}");
Console.WriteLine(body);`;
}

function java(e: EndpointSpec, { baseUrl, token, payload, withFile }: SampleInput): string {
  if (withFile) {
    return `// Multipart em Java puro é verboso: prefira OkHttp (MultipartBody) ou envie o arquivo
// por URL pública em POST /messages/send-media-url.
// OkHttp:
RequestBody body = new MultipartBody.Builder().setType(MultipartBody.FORM)
${Object.entries(payload)
  .map(([k, v]) => `    .addFormDataPart(${cString(k)}, ${cString(v)})`)
  .join("\n")}
    .addFormDataPart("medias", "${FILE}", RequestBody.create(new File("${FILE}"), MediaType.parse("application/pdf")))
    .build();
Request request = new Request.Builder()
    .url("${baseUrl}${e.path}")
    .header("Authorization", "Bearer ${token}")
    .post(body)
    .build();
try (Response res = new OkHttpClient().newCall(request).execute()) {
    System.out.println(res.code() + " " + res.body().string());
}`;
  }
  const publisher =
    e.body === "none"
      ? e.method === "GET"
        ? ".GET()"
        : ".POST(HttpRequest.BodyPublishers.noBody())"
      : `.header("Content-Type", "application/json")\n    .POST(HttpRequest.BodyPublishers.ofString(${cString(JSON.stringify(payload))}))`;
  return `import java.net.URI;
import java.net.http.*;
import java.time.Duration;

HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
HttpRequest request = HttpRequest.newBuilder(URI.create("${baseUrl}${e.path}"))
    .timeout(Duration.ofSeconds(30))
    .header("Authorization", "Bearer ${token}")
    ${publisher}
    .build();
HttpResponse<String> res = client.send(request, HttpResponse.BodyHandlers.ofString());
if (res.statusCode() >= 400) throw new RuntimeException(res.statusCode() + ": " + res.body());
System.out.println(res.body());`;
}

function delphi(e: EndpointSpec, { baseUrl, token, payload, withFile }: SampleInput): string {
  const header = `uses System.Net.HttpClient, System.Net.URLClient, System.Net.Mime, System.Classes, System.JSON, System.SysUtils;

const
  BASE_URL = ${pascal(baseUrl)};
  TOKEN = ${pascal(token)};

var
  Client: THTTPClient;
  Res: IHTTPResponse;`;
  const auth = `  Client.CustomHeaders['Authorization'] := 'Bearer ' + TOKEN;`;
  let vars = "";
  let body: string;
  if (withFile) {
    vars = "\n  Form: TMultipartFormData;";
    body = `    Form := TMultipartFormData.Create;
    try
${Object.entries(payload)
  .map(([k, v]) => `      Form.AddField(${pascal(k)}, ${pascal(v)});`)
  .join("\n")}
      Form.AddFile('medias', '${FILE}');
      Res := Client.Post(BASE_URL + '${e.path}', Form);
    finally
      Form.Free;
    end;`;
  } else if (e.body === "none") {
    body = `    Res := Client.${e.method === "GET" ? "Get" : "Post"}(BASE_URL + '${e.path}'${e.method === "POST" ? ", TStream(nil)" : ""});`;
  } else {
    vars = "\n  Body: TStringStream;";
    body = `    Body := TStringStream.Create(${pascal(JSON.stringify(payload))}, TEncoding.UTF8);
    try
      Client.ContentType := 'application/json';
      Res := Client.Post(BASE_URL + '${e.path}', Body);
    finally
      Body.Free;
    end;`;
  }
  return `${header}${vars}
begin
  Client := THTTPClient.Create;
  try
${auth}
    Client.ResponseTimeout := 30000;
${body}
    if Res.StatusCode >= 400 then
      raise Exception.CreateFmt('%d: %s', [Res.StatusCode, Res.ContentAsString(TEncoding.UTF8)]);
    Writeln(Res.ContentAsString(TEncoding.UTF8));
  finally
    Client.Free;
  end;
end;`;
}

const BUILDERS: Record<Language, (e: EndpointSpec, input: SampleInput) => string> = {
  curl,
  javascript,
  php,
  python,
  csharp,
  java,
  delphi,
};

export function buildSample(language: Language, endpoint: EndpointSpec, input: SampleInput): string {
  return BUILDERS[language](endpoint, input);
}
