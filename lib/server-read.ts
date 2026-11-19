/** Read an API route's answer from a SERVER component, without a network hop and without copying the route's logic.
 *
 *  A page that wants its data in the first HTML calls the route's own GET handler and uses the JSON it would have sent the browser. The handler reads the same cookies
 *  (they are available to server components), so it sees the same signed-in user, and the page and the route can never disagree about what the data is. Any failure
 *  is `null`: the component then loads its own data exactly as before. */
export async function readRoute<T = any>(handler: () => Promise<Response>): Promise<T | null> {
  try {
    const res = await handler();
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
