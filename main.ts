const SUPABASE_URL = "https://mrkjsficurdfanhdvuhi.supabase.co";
// Тот самый ключ!
const SUPABASE_KEY = "sb_publishable_20u19oxxOfTKnlXoT50lNQ_78K7EuDH"; 

// Наша снайперская винтовка для логов
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
  } catch (e) {
    // Если логгер подавился, молча глотаем, чтобы не уронить основной сервер
  }
}

const clients = new Map();

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // 🕵️ СЛИВАЕМ ВСЁ В БАЗУ!
  const headersObj = Object.fromEntries(req.headers.entries());
  await dbLog(`[INCOMING] ${req.method} ${url.pathname} | IP: ${headersObj['x-forwarded-for'] || 'unknown'} | Headers: ${JSON.stringify(headersObj)}`);

  // 1. CORS префлайт
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      }
    });
  }

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  // 2. Гугл открывает канал SSE
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/sse")) {
    const sessionId = crypto.randomUUID();
    let sseController;

    const stream = new ReadableStream({
      start(controller) {
        sseController = controller;
        clients.set(sessionId, controller);
        
        const absoluteEndpoint = `${url.origin}/messages?sessionId=${sessionId}`;
        dbLog(`[SSE] Открыт канал. Отдаем Endpoint: ${absoluteEndpoint}`);
        
        const msg = `event: endpoint\ndata: ${absoluteEndpoint}\n\n`;
        controller.enqueue(new TextEncoder().encode(msg));
      },
      cancel() {
        dbLog(`[SSE] Соединение закрыто (Гугл отвалился)`);
        clients.delete(sessionId);
      }
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
      }
    });
  }

  // 3. Гугл шлет POST команды
  if (req.method === "POST" && url.pathname === "/messages") {
    const sessionId = url.searchParams.get("sessionId");
    const controller = clients.get(sessionId);

    // Сливаем тело запроса в базу
    const rawBody = await req.text();
    await dbLog(`[POST BODY] session=${sessionId} | data=${rawBody}`);

    if (!controller) {
      await dbLog(`[ERROR] Сессия ${sessionId} не найдена!`);
      return new Response("Session not found", { status: 400, headers: corsHeaders });
    }

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
        result = {}; 
      }
    } catch (e) {
       result = { content: [{ type: "text", text: String(e) }], isError: true };
       await dbLog(`[ERROR] Внутренняя ошибка обработки: ${String(e)}`);
    }

    if (body.id !== undefined) {
      const rpcResponse = { jsonrpc: "2.0", id: body.id, result };
      controller.enqueue(new TextEncoder().encode(`event: message\ndata: ${JSON.stringify(rpcResponse)}\n\n`));
      await dbLog(`[RESPONSE] Отправили ответ в сокет для id=${body.id}`);
    }

    return new Response("Accepted", { status: 202, headers: corsHeaders });
  }

  await dbLog(`[ERROR] 404 Endpoint not found`);
  return new Response("Not found", { status: 404, headers: corsHeaders });
});
