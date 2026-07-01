"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
	TOOL_KIND_CATEGORY,
	type ToolCategory,
	type ToolSummary,
	trpcClient,
} from "@/lib/trpc";

export interface ToolsAndSkillsSelection {
	skillIds: string[];
	toolIds: string[];
}

const CATEGORY_LABEL: Record<ToolCategory, string> = {
	edit: "Edit",
	read: "Read",
	search: "Search",
	execute: "Execute",
	browser: "Browser",
	web: "Web",
};

const CATEGORY_ORDER: ToolCategory[] = [
	"edit",
	"read",
	"search",
	"execute",
	"browser",
	"web",
];

/** The categorized checkbox tree the chat composer's settings menu opens —
 * mirrors the VS Code-style agent tool list this feature was modeled on:
 * Agent / Skills / Edit / Execute / Read / Search / Web. "Agent" has no
 * per-item toggle here since delegate_to_agent is configured per-agent on
 * the Agents page, not per-chat — this just points there. */
export function ToolsAndSkillsPicker({
	workspaceId,
	value,
	onChange,
}: {
	workspaceId: string | undefined;
	value: ToolsAndSkillsSelection;
	onChange: (next: ToolsAndSkillsSelection) => void;
}) {
	const [collapsed, setCollapsed] = useState<Set<ToolCategory>>(new Set());

	const skillsQuery = useQuery({
		queryKey: ["skills", "list", workspaceId],
		queryFn: () => trpcClient.skills.list.query({ workspaceId: workspaceId! }),
		enabled: Boolean(workspaceId),
	});
	const toolsQuery = useQuery({
		queryKey: ["tools", "list", workspaceId],
		queryFn: () => trpcClient.tools.list.query({ workspaceId: workspaceId! }),
		enabled: Boolean(workspaceId),
	});

	const skills = skillsQuery.data ?? [];
	const tools = toolsQuery.data ?? [];
	const toolsByCategory = new Map<ToolCategory, ToolSummary[]>();
	for (const toolItem of tools) {
		const category = TOOL_KIND_CATEGORY[toolItem.kind];
		const list = toolsByCategory.get(category) ?? [];
		list.push(toolItem);
		toolsByCategory.set(category, list);
	}

	function toggleSkill(skillId: string) {
		const next = value.skillIds.includes(skillId)
			? value.skillIds.filter((id) => id !== skillId)
			: [...value.skillIds, skillId];
		onChange({ ...value, skillIds: next });
	}

	function toggleTool(toolId: string) {
		const next = value.toolIds.includes(toolId)
			? value.toolIds.filter((id) => id !== toolId)
			: [...value.toolIds, toolId];
		onChange({ ...value, toolIds: next });
	}

	function toggleCategoryCollapsed(category: ToolCategory) {
		setCollapsed((prev) => {
			const next = new Set(prev);
			if (next.has(category)) next.delete(category);
			else next.add(category);
			return next;
		});
	}

	return (
		<div className="max-h-96 space-y-4 overflow-y-auto">
			<div className="space-y-1.5">
				<div className="flex items-center justify-between">
					<p className="text-xs font-medium text-muted-foreground">Agent</p>
				</div>
				<p className="text-xs text-muted-foreground">
					Delegating to other agents is configured per-agent — see the Agents
					page's "Delegate to" section.
				</p>
			</div>

			<Separator />

			<div className="space-y-1.5">
				<p className="text-xs font-medium text-muted-foreground">Skills</p>
				{skills.length === 0 && (
					<p className="text-xs text-muted-foreground">None available.</p>
				)}
				{skills.map((skill) => (
					<div key={skill.id} className="flex items-center gap-2">
						<Checkbox
							id={`picker-skill-${skill.id}`}
							checked={value.skillIds.includes(skill.id)}
							onCheckedChange={() => toggleSkill(skill.id)}
						/>
						<Label
							htmlFor={`picker-skill-${skill.id}`}
							className="flex-1 truncate font-normal"
						>
							{skill.name}
						</Label>
					</div>
				))}
			</div>

			{CATEGORY_ORDER.filter((category) => toolsByCategory.has(category)).map(
				(category) => {
					const isCollapsed = collapsed.has(category);
					const categoryTools = toolsByCategory.get(category) ?? [];
					return (
						<div key={category}>
							<Separator className="mb-4" />
							<div className="space-y-1.5">
								<button
									type="button"
									onClick={() => toggleCategoryCollapsed(category)}
									className="flex w-full items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
								>
									{isCollapsed ? (
										<ChevronRight className="size-3.5" />
									) : (
										<ChevronDown className="size-3.5" />
									)}
									{CATEGORY_LABEL[category]}
								</button>
								{!isCollapsed &&
									categoryTools.map((toolItem) => (
										<div key={toolItem.id} className="flex items-center gap-2 pl-1">
											<Checkbox
												id={`picker-tool-${toolItem.id}`}
												checked={value.toolIds.includes(toolItem.id)}
												disabled={!toolItem.enabled}
												onCheckedChange={() => toggleTool(toolItem.id)}
											/>
											<Label
												htmlFor={`picker-tool-${toolItem.id}`}
												className="flex-1 truncate font-normal"
											>
												{toolItem.name}
												{!toolItem.enabled && (
													<span className="ml-1 text-xs text-muted-foreground">
														(disabled)
													</span>
												)}
											</Label>
										</div>
									))}
							</div>
						</div>
					);
				},
			)}
		</div>
	);
}
