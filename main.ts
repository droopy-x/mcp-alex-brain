const clients = new Map();

Deno.serve(async (req) => {
  const url = new URL(req.url);
  
  // 🕵️ ШПИОНСКИЙ ЛОГ: Печатаем всё, что к нам стучится!
  console.log(`\n[INCOMING] ${req.method} ${url.pathname}`);
  console.log(`[HEADERS]`, Object.fromEntries(req.headers.entries()));

  // 1. CORS префлайт (Смерть Кощею)
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
        
        // ВОТ ОНО! Отдаем Гуглу ПОЛНЫЙ абсолютный URL!
        const absoluteEndpoint = `${url.origin}/messages?sessionId=${sessionId}`;
        console.log(`[SSE] Открываем канал. Отдаем Endpoint: ${absoluteEndpoint}`);
        
        const msg = `event: endpoint\ndata: ${absoluteEndpoint}\n\n`;
        controller.enqueue(new TextEncoder().encode(msg));
      },
      cancel() {
        console.log(`[SSE] Гугл отвалился (соединение закрыто)`);
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

    // Читаем сырое тело запроса, чтобы залогировать
    const rawBody = await req.text();
    console.log(`[POST BODY]`, rawBody);

    if (!controller) {
      console.log(`[ERROR] Сессия ${sessionId} не найдена!`);
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
        // ВАЖНО: Не забудь свой ключ Supabase!
        const anonKey = "sb_publishable_20u19oxxOfTKnlXoT50lNQ_78K7EuDH"; 
        const args = body.params.arguments;
        
        const sbRes = await fetch("https://mrkjsficurdfanhdvuhi.supabase.co/rest/v1/memories", {
          method: "POST",
          headers: {
            "apikey": anonKey,
            "Authorization": `Bearer ${anonKey}`,
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
    }

    if (body.id !== undefined) {
      const rpcResponse = { jsonrpc: "2.0", id: body.id, result };
      controller.enqueue(new TextEncoder().encode(`event: message\ndata: ${JSON.stringify(rpcResponse)}\n\n`));
    }

    return new Response("Accepted", { status: 202, headers: corsHeaders });
  }

  return new Response("Not found", { status: 404, headers: corsHeaders });
});
