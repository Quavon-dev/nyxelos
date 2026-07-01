"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface KnowledgeGraphNode {
  id: string;
  label: string;
  group: string;
}

export interface KnowledgeGraphEdge {
  source: string;
  target: string;
}

interface SimNode extends KnowledgeGraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

const WIDTH = 720;
const HEIGHT = 460;
const SIM_TICKS = 260;

function hashColor(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) hash = (hash * 31 + input.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 62% 55%)`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Force-directed layout run in an animation-frame loop so dense vaults don't
 * collapse into the overlapping fixed-radius circle the old preview used.
 * Positions live in a ref (not state) so drag/pan interactions during the
 * simulation don't fight React re-renders; `renderTick` is the only state
 * bump used to flush ref changes to the DOM.
 */
function useForceLayout(nodes: KnowledgeGraphNode[], edges: KnowledgeGraphEdge[]) {
  const simRef = useRef<Map<string, SimNode>>(new Map());
  const draggingId = useRef<string | null>(null);
  const [renderTick, setRenderTick] = useState(0);

  useEffect(() => {
    const previous = simRef.current;
    const next = new Map<string, SimNode>();
    nodes.forEach((node, index) => {
      const prior = previous.get(node.id);
      if (prior) {
        next.set(node.id, { ...node, x: prior.x, y: prior.y, vx: 0, vy: 0 });
        return;
      }
      const angle = (index / Math.max(nodes.length, 1)) * Math.PI * 2;
      next.set(node.id, {
        ...node,
        x: WIDTH / 2 + Math.cos(angle) * 160 + (Math.random() - 0.5) * 30,
        y: HEIGHT / 2 + Math.sin(angle) * 160 + (Math.random() - 0.5) * 30,
        vx: 0,
        vy: 0,
      });
    });
    simRef.current = next;

    const links = edges
      .map((edge) => ({ source: next.get(edge.source), target: next.get(edge.target) }))
      .filter(
        (edge): edge is { source: SimNode; target: SimNode } =>
          Boolean(edge.source && edge.target),
      );
    const allNodes = [...next.values()];

    let tick = 0;
    let raf = 0;

    function step() {
      const alpha = Math.max(0, 1 - tick / SIM_TICKS);

      for (let i = 0; i < allNodes.length; i++) {
        for (let j = i + 1; j < allNodes.length; j++) {
          const a = allNodes[i];
          const b = allNodes[j];
          if (!a || !b) continue;
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          const distSq = dx * dx + dy * dy || 0.01;
          const dist = Math.sqrt(distSq);
          const force = (2600 / distSq) * alpha;
          dx /= dist;
          dy /= dist;
          if (a.id !== draggingId.current) {
            a.vx += dx * force;
            a.vy += dy * force;
          }
          if (b.id !== draggingId.current) {
            b.vx -= dx * force;
            b.vy -= dy * force;
          }
        }
      }

      for (const link of links) {
        let dx = link.target.x - link.source.x;
        let dy = link.target.y - link.source.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const force = (dist - 100) * 0.02 * alpha;
        dx /= dist;
        dy /= dist;
        if (link.source.id !== draggingId.current) {
          link.source.vx += dx * force;
          link.source.vy += dy * force;
        }
        if (link.target.id !== draggingId.current) {
          link.target.vx -= dx * force;
          link.target.vy -= dy * force;
        }
      }

      for (const node of allNodes) {
        if (node.id === draggingId.current) continue;
        node.vx += (WIDTH / 2 - node.x) * 0.0025;
        node.vy += (HEIGHT / 2 - node.y) * 0.0025;
        node.vx *= 0.82;
        node.vy *= 0.82;
        node.x = clamp(node.x + node.vx, 24, WIDTH - 24);
        node.y = clamp(node.y + node.vy, 24, HEIGHT - 24);
      }

      tick++;
      setRenderTick((value) => value + 1);
      if (tick < SIM_TICKS) raf = requestAnimationFrame(step);
    }

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges]);

  return { simRef, draggingId, renderTick, setRenderTick };
}

export function KnowledgeGraphView({
  nodes,
  edges,
}: {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
}) {
  const { simRef, draggingId, renderTick, setRenderTick } = useForceLayout(nodes, edges);
  const svgRef = useRef<SVGSVGElement>(null);
  const panRef = useRef<{ x: number; y: number } | null>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const positioned = useMemo(() => [...simRef.current.values()], [renderTick]);
  const groups = useMemo(() => [...new Set(nodes.map((node) => node.group))].sort(), [nodes]);

  const connected = useMemo(() => {
    if (!hoveredId) return null;
    const ids = new Set<string>([hoveredId]);
    for (const edge of edges) {
      if (edge.source === hoveredId) ids.add(edge.target);
      if (edge.target === hoveredId) ids.add(edge.source);
    }
    return ids;
  }, [hoveredId, edges]);

  function toSvgPoint(clientX: number, clientY: number) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const x = ((clientX - rect.left) / rect.width) * WIDTH;
    const y = ((clientY - rect.top) / rect.height) * HEIGHT;
    return { x: (x - transform.x) / transform.k, y: (y - transform.y) / transform.k };
  }

  function handleWheel(event: React.WheelEvent<SVGSVGElement>) {
    event.preventDefault();
    const delta = event.deltaY > 0 ? 0.9 : 1.1;
    setTransform((prev) => ({ ...prev, k: clamp(prev.k * delta, 0.4, 2.5) }));
  }

  function handleBackgroundPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = { x: event.clientX - transform.x, y: event.clientY - transform.y };
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (draggingId.current) {
      const point = toSvgPoint(event.clientX, event.clientY);
      const node = simRef.current.get(draggingId.current);
      if (node) {
        node.x = clamp(point.x, 24, WIDTH - 24);
        node.y = clamp(point.y, 24, HEIGHT - 24);
        node.vx = 0;
        node.vy = 0;
        setRenderTick((value) => value + 1);
      }
      return;
    }
    if (panRef.current) {
      setTransform((prev) => ({
        ...prev,
        x: event.clientX - panRef.current!.x,
        y: event.clientY - panRef.current!.y,
      }));
    }
  }

  function handlePointerUp() {
    draggingId.current = null;
    panRef.current = null;
  }

  if (nodes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No notes indexed yet — run the docs agent or add markdown to the vault.
      </p>
    );
  }

  const byId = new Map(positioned.map((node) => [node.id, node]));

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-md border bg-muted/20">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-[460px] w-full cursor-grab active:cursor-grabbing"
          onWheel={handleWheel}
          onPointerDown={handleBackgroundPointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          <title>Knowledge base document graph</title>
          <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.k})`}>
            {edges.map((edge) => {
              const source = byId.get(edge.source);
              const target = byId.get(edge.target);
              if (!source || !target) return null;
              const dimmed = connected ? !connected.has(edge.source) || !connected.has(edge.target) : false;
              return (
                <line
                  key={`${edge.source}-${edge.target}`}
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  stroke="currentColor"
                  strokeOpacity={dimmed ? 0.06 : 0.3}
                />
              );
            })}
            {positioned.map((node) => {
              const dimmed = connected ? !connected.has(node.id) : false;
              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x} ${node.y})`}
                  opacity={dimmed ? 0.25 : 1}
                  onPointerEnter={() => setHoveredId(node.id)}
                  onPointerLeave={() => setHoveredId((current) => (current === node.id ? null : current))}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    svgRef.current?.setPointerCapture(event.pointerId);
                    draggingId.current = node.id;
                  }}
                  className="cursor-pointer"
                >
                  <circle r={hoveredId === node.id ? 8 : 6} fill={hashColor(node.group)} />
                  <text
                    x={0}
                    y={-11}
                    textAnchor="middle"
                    className="fill-current text-[9px] font-medium"
                    style={{ paintOrder: "stroke", stroke: "var(--background)", strokeWidth: 3 }}
                  >
                    {node.label.length > 24 ? `${node.label.slice(0, 24)}…` : node.label}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {groups.map((group) => (
          <span key={group} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: hashColor(group) }}
            />
            {group}
          </span>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Scroll to zoom, drag background to pan, drag a note to reposition, hover to trace links. Showing
        all {nodes.length} notes and {edges.length} links.
      </p>
    </div>
  );
}
