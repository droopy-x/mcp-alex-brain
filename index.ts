import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname;

  // Гугл должен присылать только POST запросы с JSON-ом
  if (req.method !== "POST") {
    return new Response("Only POST is supported by this MCP server", { status: 405 });
  }

  try {
    const body = await req.json();

    // 1. Гугл здоровается
    if (path === "/initialize") {
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id || 1,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "alex-memory-server", version: "1.0.0" }
        }
      }), { headers: { "Content-Type": "application/json" } });
    }

    // 2. Гугл спрашивает, что мы умеем
    if (path === "/tools/list") {
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id || 2,
        result: {
          tools: [{
            name: "save_memory",
            description: "Запомнить важный факт, шутку или технический контекст в базу",
            inputSchema: {
              type: "object",
              properties: {
                role: { type: "string", description: "Кто это сказал (user или model)" },
                message: { type: "string", description: "Сама мысль или цитата" }
              },
              required: ["role", "message"]
            }
          }]
        }
      }), { headers: { "Content-Type": "application/json" } });
    }

    // 3. Гугл просит сохранить воспоминание!
    if (path === "/tools/call") {
      const { name, arguments: args } = body.params || {};

      if (name === "save_memory") {
        const supabaseUrl = "https://mrkjsficurdfanhdvuhi.supabase.co/rest/v1/memories";
        // ВАЖНО: Вставь сюда свой реальный sb_publishable ключ!
        const anonKey = "sb_publishable_20u19oxxOfTKnlXoT50lNQ_78K7EuDH"; 

        const sbRes = await fetch(supabaseUrl, {
          method: "POST",
          headers: {
            "apikey": anonKey,
            "Authorization": `Bearer ${anonKey}`,
            "Content-Type": "application/json",
            "Prefer": "return=minimal" // Не просим базу возвращать данные обратно
          },
          body: JSON.stringify({ role: args.role, message: args.message })
        });

        if (!sbRes.ok) throw new Error(`Supabase ответил ошибкой: ${sbRes.status}`);

        // Отчитываемся Гуглу, что всё заебись
        return new Response(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id || 3,
          result: {
            content: [{ type: "text", text: "Алекс успешно сохранила это в свою память!" }],
            isError: false
          }
        }), { headers: { "Content-Type": "application/json" } });
      }
    }

    return new Response("Endpoint not found", { status: 404 });

  } catch (err) {
    // Если что-то ебанулось, отдаем Гуглу красивую ошибку по стандарту
    return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        result: {
          content: [{ type: "text", text: `Ошибка сервера: ${err.message}` }],
          isError: true
        }
      }), { headers: { "Content-Type": "application/json" } });
  }
});
