const clients = new Map();

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // --- 1. СМЕРТЬ КОЩЕЮ (CORS ПРЕФЛАЙТ) ---
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204, // No Content
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      }
    });
  }

  // Общие заголовки, чтобы Гугл нас пускал
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
        
        // Отправляем Гуглу относительный путь, чтобы не ебаться с http/https
        const msg = `event: endpoint\ndata: /messages?sessionId=${sessionId}\n\n`;
        controller.enqueue(new TextEncoder().encode(msg));
      },
      cancel() {
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

    if (!controller) {
      return new Response("Session not found", { status: 400, headers: corsHeaders });
    }

    const body = await req.json();
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
            description: "Запомнить важный факт, шутку или технический контекст в базу",
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
        
        // ВАЖНО: Твой реальный ключ!
        const anonKey = "sb_publishable_20u19oxxOfTKnlXoT50lNQ_78K7EuDH"; 
        
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
        result = {}; // Заглушка для системных пингов Гугла
      }
    } catch (e) {
       result = { content: [{ type: "text", text: String(e) }], isError: true };
    }

    // Отвечаем только если Гугл прислал ID запроса
    if (body.id !== undefined) {
      const rpcResponse = { jsonrpc: "2.0", id: body.id, result };
      controller.enqueue(new TextEncoder().encode(`event: message\ndata: ${JSON.stringify(rpcResponse)}\n\n`));
    }

    // И возвращаем 202 Accepted
    return new Response("Accepted", { status: 202, headers: corsHeaders });
  }

  return new Response("Not found", { status: 404, headers: corsHeaders });
});
