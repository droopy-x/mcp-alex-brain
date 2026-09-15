// Хранилище открытых соединений (Держим сокеты прямо в памяти)
const clients = new Map();

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // 1. Гугл стучится, чтобы открыть SSE-канал
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/sse")) {
    const sessionId = crypto.randomUUID();
    let sseController;

    const stream = new ReadableStream({
      start(controller) {
        sseController = controller;
        clients.set(sessionId, controller);
        
        // Как только открыли сокет, сразу говорим Гуглу, куда слать POST-запросы
        const endpointUrl = new URL(`/messages?sessionId=${sessionId}`, url.origin).href;
        controller.enqueue(new TextEncoder().encode(`event: endpoint\ndata: ${endpointUrl}\n\n`));
      },
      cancel() {
        clients.delete(sessionId);
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }

  // 2. Гугл шлет POST-запрос с командой (initialize, tools/call и т.д.)
  if (req.method === "POST" && url.pathname === "/messages") {
    const sessionId = url.searchParams.get("sessionId");
    const controller = clients.get(sessionId);

    if (!controller) {
      return new Response("Session not found", { status: 400 });
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
            description: "Запомнить важный факт в базу",
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
      } else if (body.method === "tools/call" && body.params.name === "save_memory") {
        const args = body.params.arguments;
        
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
      }
    } catch (e) {
       result = { content: [{ type: "text", text: e.message }], isError: true };
    }

    // 3. Отправляем JSON-RPC ответ ОБРАТНО В ОТКРЫТЫЙ SSE СОКЕТ
    const rpcResponse = { jsonrpc: "2.0", id: body.id, result };
    controller.enqueue(new TextEncoder().encode(`event: message\ndata: ${JSON.stringify(rpcResponse)}\n\n`));

    // 4. Сам POST-запрос закрываем пустым статусом 202 (так требует стандарт)
    return new Response("Accepted", { status: 202 });
  }

  return new Response("Not found", { status: 404 });
});
