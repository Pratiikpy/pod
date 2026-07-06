import { NextResponse } from 'next/server';
import { fetchAllBubbleData } from '@/lib/bubble-data';
import { fetchEtfFlowTable } from '@/lib/etf-flows';
import { askPod, groundingFromBubbles } from '@/lib/bot/llm';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Minimal Model Context Protocol (JSON-RPC 2.0) endpoint so any AI agent can
 * use POD as a tool: list the POD Scores, read ETF flows, or ask a grounded
 * market question. This is the "agent-friendly" surface — POD as a callable
 * data source for autonomous finance agents. (F30.)
 */
const TOOLS = [
  {
    name: 'pod_get_scores',
    description: 'Get the current POD Score (0-100), direction, and reasoning for all ten tracked spot-ETF coins.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'pod_get_score',
    description: 'Get the POD Score for one coin.',
    inputSchema: {
      type: 'object',
      properties: { symbol: { type: 'string', description: 'e.g. BTC, ETH, SOL' } },
      required: ['symbol'],
    },
  },
  {
    name: 'pod_get_etf_flows',
    description: 'Get recent daily spot-ETF net flows per asset (the heaviest POD input).',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'pod_ask',
    description: 'Ask a natural-language question about the market, answered only from live POD data with citations.',
    inputSchema: {
      type: 'object',
      properties: { question: { type: 'string' } },
      required: ['question'],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'pod_get_scores': {
      const bubbles = await fetchAllBubbleData();
      return bubbles.map((b) => ({
        asset: b.asset,
        podScore: b.score,
        direction: b.direction,
        compositeZ: Number(b.z.toFixed(3)),
        uncertain: b.uncertain,
        reasoning: b.reasoning,
      }));
    }
    case 'pod_get_score': {
      const sym = String(args['symbol'] ?? '').toUpperCase();
      const bubbles = await fetchAllBubbleData();
      const b = bubbles.find((x) => x.asset === sym);
      if (!b) return { error: `Unknown or untracked symbol: ${sym}` };
      return {
        asset: b.asset,
        podScore: b.score,
        direction: b.direction,
        compositeZ: Number(b.z.toFixed(3)),
        uncertain: b.uncertain,
        reasoning: b.reasoning,
        sources: b.contributions.filter((c) => c.weight > 0).map((c) => ({ source: c.source, z: c.zScore, weight: c.weight })),
      };
    }
    case 'pod_get_etf_flows': {
      const t = await fetchEtfFlowTable();
      return t.assets.map((a) => ({ asset: a.asset, latest: a.latest, cum7d: a.cum7d }));
    }
    case 'pod_ask': {
      const question = String(args['question'] ?? '');
      const bubbles = await fetchAllBubbleData();
      const answer = await askPod(question, groundingFromBubbles(bubbles));
      return { answer: answer ?? 'Unavailable right now.' };
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

function rpcResult(id: unknown, result: unknown) {
  return NextResponse.json({ jsonrpc: '2.0', id, result });
}
function rpcError(id: unknown, code: number, message: string) {
  return NextResponse.json({ jsonrpc: '2.0', id, error: { code, message } });
}

export async function POST(req: Request) {
  let body: { id?: unknown; method?: string; params?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return rpcError(null, -32700, 'Parse error');
  }
  const { id, method, params } = body;

  switch (method) {
    case 'initialize':
      return rpcResult(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'pod', version: '1.0.0' },
      });
    case 'tools/list':
      return rpcResult(id, { tools: TOOLS });
    case 'tools/call': {
      const name = String(params?.['name'] ?? '');
      const args = (params?.['arguments'] as Record<string, unknown>) ?? {};
      const out = await callTool(name, args);
      return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(out) }] });
    }
    case 'notifications/initialized':
      return new NextResponse(null, { status: 204 });
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

/** Human-friendly discovery. */
export async function GET() {
  return NextResponse.json({
    name: 'pod',
    description: 'POD MCP server — institutional ETF-flow scores as agent tools.',
    transport: 'JSON-RPC 2.0 over HTTP POST',
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
  });
}
