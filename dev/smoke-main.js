const path = require("path"); const E = require("electron"); process.argv = [process.argv[0], ".", "/tmp/nonexistent.pdf"];
require("../src/main/main.js");
setTimeout(async () => {
  console.log("calls:", E.__calls.map((c) => c[0] + (c[1] ? ":" + String(c[1]).slice(0, 60) : "")).join(" | "));
  const h = E.__ipc.handlers; console.log("ipc handlers:", Object.keys(h).length);
  // protocol mapping
  const r1 = await E.__handler({ url: "app://lovepdf/index.html" }); const r2 = await E.__handler({ url: "app://lovepdf/vendor/pdf-lib.min.js" }); const r3 = await E.__handler({ url: "app://lovepdf/../../etc/passwd" });
  console.log("protocol index:", E.__calls.filter((c) => c[0] === "netfetch").map((c) => c[1].replace(/^file:\/\/.*lovepdf-reader/, "")).join(" , "), "| traversal status:", r3.status);
  console.log("settings:", JSON.stringify(await h["settings:get"]()), "| info:", (await h["app:info"]()).version);
  await h["settings:set"](null, { theme: "dark", lang: "ur" }); console.log("after set:", JSON.stringify(await h["settings:get"]()));
  const fs = require("fs"); const p = "/tmp/claude-0/-home-claude/40b0bb09-62af-5ec4-bf21-41fbbf505721/scratchpad/ten.pdf"; const buf = await h["file:read"](null, p); console.log("read bytes:", buf.length, "| recent:", (await h["recent:get"]()).length);
  await h["file:write"](null, { path: "/tmp/claude-0/-home-claude/40b0bb09-62af-5ec4-bf21-41fbbf505721/scratchpad/mock-out.pdf", data: new Uint8Array([1, 2, 3]) }); console.log("write ok:", fs.statSync("/tmp/claude-0/-home-claude/40b0bb09-62af-5ec4-bf21-41fbbf505721/scratchpad/mock-out.pdf").size);
  console.log("saveAs:", await h["dialog:saveAs"](null, { defaultName: "a.pdf" }), "| print:", await h["app:print"](null, {}));
  try { await h["net:fetch"](null, { url: "http://insecure" }); } catch (e) { console.log("net guard:", e.message); }
  process.exit(0);
}, 300);
