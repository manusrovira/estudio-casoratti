const url = "https://hebooqzvbnwuabujkbff.supabase.co";
const anon = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhlYm9vcXp2Ym53dWFidWprYmZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ2NDAxNjEsImV4cCI6MjExMDIxNjE2MX0.AeKPiSYjuLVdy5kWN0x1NhquNRFBDH4aHKsWvlOines";
const origin = "https://estudio-casoratti.vercel.app";

(async () => {
  for (const [label, path, method, headers] of [
    ["preflight /auth/v1/token", "/auth/v1/token?grant_type=password", "OPTIONS", { "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "apikey,authorization,content-type,x-client-info" }],
    ["preflight /rest/v1/profiles", "/rest/v1/profiles", "OPTIONS", { "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "apikey,authorization,x-client-info" }],
  ]) {
    const r = await fetch(url + path, { method, headers: { Origin: origin, ...headers } });
    console.log(`${label} -> ${r.status} allow-origin=${r.headers.get("access-control-allow-origin")} allow-headers=${r.headers.get("access-control-allow-headers")}`);
  }
  // POST real de login desde el origen desplegado
  const login = await fetch(url + "/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json", Origin: origin, "x-client-info": "supabase-js/2.119.0" },
    body: JSON.stringify({ email: "admin@estudiocasoratti.com.ar", password: "casoratti2026" }),
  });
  console.log("login POST ->", login.status, "allow-origin=", login.headers.get("access-control-allow-origin"));
  const d = await login.json();
  if (d.access_token) {
    const u = await fetch(url + "/auth/v1/user", { headers: { apikey: anon, Authorization: `Bearer ${d.access_token}`, Origin: origin } });
    console.log("GET /user ->", u.status, "allow-origin=", u.headers.get("access-control-allow-origin"));
  } else {
    console.log("body:", JSON.stringify(d).slice(0, 200));
  }
})();
