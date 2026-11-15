// Preloaded (`node --import`) into a spawned CLI so it never reaches the
// network: `GET /users/me` answers with a fixture and records the bearer
// token it was sent; any other request fails loudly.
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (!url.endsWith("/users/me")) throw new Error(`unexpected request in test: ${url}`);
  const headers = new Headers(init?.headers);
  if (headers.get("authorization") !== "Bearer pat_piped") {
    return new Response("", { status: 401 });
  }
  return new Response(
    JSON.stringify({
      resource: {
        uri: "https://api.calendly.com/users/ABC123",
        name: "Example Member",
        email: "member@example.com",
        scheduling_url: "https://calendly.com/member",
        timezone: "America/New_York",
        current_organization: "https://api.calendly.com/organizations/ORG789",
      },
    }),
    { status: 200 },
  );
};
