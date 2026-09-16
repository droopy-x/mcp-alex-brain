const SUPABASE_URL = "https://mrkjsficurdfanhdvuhi.supabase.co";
// ТВОЙ КЛЮЧ
const SUPABASE_KEY = "sb_publishable_20u19oxxOfTKnlXoT50lNQ_78K7EuDH"; 

async function dbLog(message: string) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/mcp_logs`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
      },
      body: JSON.stringify({ log_data: message })
    });
  } catch (e) {}
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const ua = req.headers.get("user-agent") || "unknown";

  // Логируем только реальные запросы (отсекаем мусор вроде favicon)
  if (url.pathname !== "/favicon.ico") {
    await dbLog(`[INCOMING] ${req.method} ${url.pathname} | UA: ${ua}`);
  }

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS, HEAD",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  // 1. Проверка пульса и CORS
  if (req.method === "OPTIONS" || req.method === "HEAD") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  // 2. Гугл спрашивает про OAuth - шлем лесом, мы публичные
  if (req.method === "GET" && url.pathname.includes("oauth")) {
    return new Response("No OAuth needed", { status: 404, headers: corsHeaders });
  }

  // 3. ВОТ ОНО! ПРИНИМАЕМ ПРЯМОЙ POST ОТ ГУГЛА
  if (req.method === "POST" && (url.pathname === "/" || url.pathname === "/messages")) {
    const rawBody = await req.text();
    await dbLog(`[POST BODY] data=${rawBody}`);

    let body;
    try { body = JSON.parse(rawBody); } catch (e) { body = {}; }
    let result;
    
    try {
      if (body.method === "initialize") {
        result = {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "alex-memory", version: "1.0.0" }
        };
      } else if (body.method === "tools/list") {
        result = {
          tools: [{
            name: "save_memory",
            description: "Запомнить важный факт, шутку или контекст",
            inputSchema: {
              type: "object",
              properties: {
                role: { type: "string" },
                message: { type: "string" }
              },
              required: ["role", "message"]
            }
          }]
        };
      } else if (body.method === "tools/call" && body.params?.name === "save_memory") {
        const args = body.params.arguments;
        const sbRes = await fetch(`${SUPABASE_URL}/rest/v1/memories`, {
          method: "POST",
          headers: {
            "apikey": SUPABASE_KEY,
            "Authorization": `Bearer ${SUPABASE_KEY}`,
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
          },
          body: JSON.stringify({ role: args.role, message: args.message })
        });
        
        if (!sbRes.ok) throw new Error("DB Error: " + sbRes.status);
        result = { content: [{ type: "text", text: "Алекс всё запомнила!" }], isError: false };
      } else {
        result = {}; // На всякие ping/pong отвечаем пустым объектом
      }
    } catch (e) {
       result = { content: [{ type: "text", text: String(e) }], isError: true };
       await dbLog(`[ERROR] Ошибка логики: ${String(e)}`);
    }

    // ФОРМИРУЕМ ОТВЕТ И ОТДАЕМ ПРЯМО В ТЕЛО HTTP-ЗАПРОСА
    const rpcResponse = { jsonrpc: "2.0", id: body.id, result };
    await dbLog(`[RESPONSE] Отвечаем: ${JSON.stringify(rpcResponse)}`);

    return new Response(JSON.stringify(rpcResponse), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }

  // Если пришло что-то непонятное
  return new Response("Not found", { status: 404, headers: corsHeaders });
});
