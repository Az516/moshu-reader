const SEARCH_ENDPOINT = 'https://www.bing.com/search';

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get('query')?.trim() || '';
  if (!query || query.length > 180)
    return Response.json({ error: 'Invalid search query' }, { status: 400 });

  const news = new URL(request.url).searchParams.get('provider') === 'news';
  const params = news
    ? new URLSearchParams({ q: query, hl: 'zh-CN', gl: 'CN', ceid: 'CN:zh-Hans' })
    : new URLSearchParams({ q: query, format: 'rss', mkt: 'zh-CN' });
  try {
    const response = await fetch(
      `${news ? 'https://news.google.com/rss/search' : SEARCH_ENDPOINT}?${params}`,
      {
        headers: { 'User-Agent': 'Active Reader/0.1 (+https://readest.com)' },
        signal: AbortSignal.timeout(12_000),
      },
    );
    if (!response.ok)
      return Response.json({ error: 'Search service unavailable' }, { status: response.status });
    return new Response(await response.text(), {
      headers: {
        'Content-Type': 'application/rss+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=600',
      },
    });
  } catch {
    return Response.json({ error: 'Search request failed' }, { status: 502 });
  }
}
