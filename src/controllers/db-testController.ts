type Request = any; type Response = any; type NextFunction = any;
export const getHandler = async (req: Request, res: Response) => {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  const status = {
    urlSet: !!url,
    urlValue: url ? url.substring(0, 20) + '...' : null,
    tokenSet: !!token,
    tokenValue: token ? token.substring(0, 8) + '...' : null,
    testRead: null as any,
    testWrite: null as any,
    error: null as any
  };

  if (url && token) {
    try {
      const writeRes = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(["SET", "cabfare_test_key", "hello_world"])
      });
      status.testWrite = await writeRes.json();

      const readRes = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(["GET", "cabfare_test_key"])
      });
      status.testRead = await readRes.json();
    } catch (e: any) {
      status.error = e.message || String(e);
    }
  }

  return res.json(status);
}
