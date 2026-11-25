const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { app } = require("../src/app");
const http = require("http");

let server;
let base;

before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function login(identifier, password, expectedRole) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password, expectedRole }),
  });
  const data = await res.json();
  assert.equal(res.status, 200, JSON.stringify(data));
  return data;
}

test("admin login works", async () => {
  const data = await login("a@gmail.com", "Admin@12345", "ADMIN");
  assert.equal(data.user.role, "ADMIN");
  assert.ok(data.accessToken);
});

test("staff login works", async () => {
  const data = await login("staff@stockpilot.local", "Staff@12345", "STAFF");
  assert.equal(data.user.role, "STAFF");
});

test("staff cannot stock in", async () => {
  const { accessToken } = await login("staff@stockpilot.local", "Staff@12345", "STAFF");
  const res = await fetch(`${base}/api/stock/in/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 403);
});

test("staff cannot create products", async () => {
  const { accessToken } = await login("staff@stockpilot.local", "Staff@12345", "STAFF");
  const res = await fetch(`${base}/api/products`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ sku: "X", name: "X" }),
  });
  assert.equal(res.status, 403);
});

test("staff can create stock out session", async () => {
  const { accessToken } = await login("staff@stockpilot.local", "Staff@12345", "STAFF");
  const res = await fetch(`${base}/api/stock/out/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ purpose: "DEPARTMENT_ISSUE" }),
  });
  const data = await res.json();
  assert.equal(res.status, 201, JSON.stringify(data));
  assert.ok(data.issueNo);
});

test("insufficient stock is rejected", async () => {
  const { accessToken } = await login("a@gmail.com", "Admin@12345", "ADMIN");
  const products = await (
    await fetch(`${base}/api/products`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  ).json();
  const product = products[0];
  const loc = product.stockBalances?.[0];
  if (!product || !loc) return;

  const sessionRes = await fetch(`${base}/api/stock/out/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ purpose: "OTHER" }),
  });
  const session = await sessionRes.json();

  const itemRes = await fetch(`${base}/api/stock/out/sessions/${session.id}/items`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      productId: product.id,
      locationId: loc.locationId,
      quantity: Number(loc.quantity) + 999999,
    }),
  });
  assert.equal(itemRes.status, 400);
});
