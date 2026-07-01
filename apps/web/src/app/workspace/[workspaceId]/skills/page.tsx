"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Blocks, Download, Lock, Search, Sparkles, Trash2 } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";
import { PageHeader, StatCard } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { type SkillLibraryResult, type SkillSummary, trpcClient } from "@/lib/trpc";

export default function SkillsPage() {
	const params = useParams<{ workspaceId: string }>();
	const workspaceId = params.workspaceId;
	const queryClient = useQueryClient();

	const skillsQuery = useQuery({
		queryKey: ["skills", "list", workspaceId],
		queryFn: () => trpcClient.skills.list.query({ workspaceId }),
	});

	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: ["skills", "list", workspaceId],
		});

	const [editingSlug, setEditingSlug] = useState<string | null>(null);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [body, setBody] = useState("");

	function resetForm() {
		setEditingSlug(null);
		setName("");
		setDescription("");
		setBody("");
	}

	function startEditing(skill: SkillSummary) {
		if (skill.source !== "file" || !skill.slug) return;
		setEditingSlug(skill.slug);
		setName(skill.name);
		setDescription(skill.description);
		setBody(skill.body ?? "");
	}

	const createSkill = useMutation({
		mutationFn: () =>
			trpcClient.skills.create.mutate({ workspaceId, name, description, body }),
		onSuccess: () => {
			invalidate();
			resetForm();
		},
	});

	const updateSkill = useMutation({
		mutationFn: () =>
			trpcClient.skills.update.mutate({
				workspaceId,
				slug: editingSlug as string,
				name,
				description,
				body,
			}),
		onSuccess: () => {
			invalidate();
			resetForm();
		},
	});

	const deleteSkill = useMutation({
		mutationFn: (slug: string) =>
			trpcClient.skills.delete.mutate({ workspaceId, slug }),
		onSuccess: invalidate,
	});

	const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<SkillSummary | null>(null);

	const [importUrl, setImportUrl] = useState("");
	const importFromUrl = useMutation({
		mutationFn: (url: string) =>
			trpcClient.skills.importFromUrl.mutate({ workspaceId, url }),
		onSuccess: () => {
			invalidate();
			setImportUrl("");
		},
	});

	const [librarySearch, setLibrarySearch] = useState("");
	const [searchResults, setSearchResults] = useState<SkillLibraryResult[]>([]);
	const searchLibrary = useMutation({
		mutationFn: (query: string) =>
			trpcClient.skills.searchLibrary.query({ query }),
		onSuccess: (results) => setSearchResults(results),
	});
	const importFromLibrary = useMutation({
		mutationFn: (url: string) =>
			trpcClient.skills.importFromUrl.mutate({ workspaceId, url }),
		onSuccess: (_, url) => {
			invalidate();
			setSearchResults((prev) => prev.filter((r) => r.rawUrl !== url));
		},
	});

	const isEditing = Boolean(editingSlug);
	const saveSkill = isEditing ? updateSkill : createSkill;

	const skills = skillsQuery.data ?? [];
	const builtinSkills = skills.filter((s) => s.source === "builtin");
	const fileSkills = skills.filter((s) => s.source === "file");

	return (
		<div className="mx-auto w-full max-w-4xl space-y-6 p-8">
			<PageHeader
				title="Skills"
				description="Real, file-based skills — a markdown file with a description that tells the model when to use it. Calling a skill returns its instructions for the model to follow using its other tools, not an action by itself."
			/>

			<div className="grid gap-4 sm:grid-cols-3">
				<StatCard
					label="Total skills"
					value={skills.length}
					icon={<Blocks className="size-4" />}
				/>
				<StatCard
					label="Built-in"
					value={builtinSkills.length}
					icon={<Sparkles className="size-4" />}
				/>
				<StatCard
					label="Custom"
					value={fileSkills.length}
					icon={<Blocks className="size-4" />}
				/>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Skill catalog</CardTitle>
					<CardDescription>
						Built-in skills ship with Nyxel and can't be edited or removed.
						Custom skills are real files you can edit or delete here — agents
						that reference a removed skill simply skip it.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{skills.length === 0 ? (
						<p className="text-sm text-muted-foreground">No skills yet.</p>
					) : (
						<div className="rounded-lg border">
							<Table>
								<TableHeader>
									<TableRow className="hover:bg-transparent">
										<TableHead>Name</TableHead>
										<TableHead>Source</TableHead>
										<TableHead>Description</TableHead>
										<TableHead className="w-[160px]">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{skills.map((skill) => (
										<TableRow key={skill.id}>
											<TableCell className="font-medium">
												{skill.name}
												{skill.sensitive && (
													<Lock className="ml-1.5 inline size-3 text-muted-foreground" />
												)}
											</TableCell>
											<TableCell>
												<Badge
													variant="outline"
													className={
														skill.source === "builtin"
															? "border-0 bg-muted text-muted-foreground"
															: "border-0 bg-violet-500/15 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300"
													}
												>
													{skill.source === "builtin" ? "Built-in" : "Custom"}
												</Badge>
											</TableCell>
											<TableCell className="max-w-[280px] truncate text-muted-foreground">
												{skill.description}
											</TableCell>
											<TableCell>
												{skill.source === "file" ? (
													<div className="flex items-center gap-2">
														<Button
															variant="ghost"
															size="sm"
															onClick={() => startEditing(skill)}
														>
															Edit
														</Button>
														<Button
															variant="destructive"
															size="sm"
															onClick={() => setDeleteConfirmTarget(skill)}
														>
															<Trash2 className="size-4" />
															Delete
														</Button>
													</div>
												) : (
													<span className="text-xs text-muted-foreground">
														Always on
													</span>
												)}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Import a skill</CardTitle>
					<CardDescription>
						Pull a skill from a known skill library on GitHub, or import any
						SKILL.md by URL. Imported skills land as custom, file-based
						skills — edit or delete them like any other.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-6">
					<div className="grid gap-2">
						<Label htmlFor="skill-import-url">Import from URL</Label>
						<div className="flex gap-2">
							<Input
								id="skill-import-url"
								value={importUrl}
								onChange={(e) => setImportUrl(e.target.value)}
								placeholder="https://raw.githubusercontent.com/org/repo/HEAD/skills/foo/SKILL.md"
							/>
							<Button
								onClick={() => importFromUrl.mutate(importUrl)}
								disabled={importFromUrl.isPending || !importUrl}
							>
								<Download className="size-4" />
								{importFromUrl.isPending ? "Importing…" : "Import"}
							</Button>
						</div>
						{importFromUrl.isError && (
							<p className="text-sm text-destructive">
								{(importFromUrl.error as Error).message}
							</p>
						)}
					</div>

					<div className="grid gap-2 border-t pt-4">
						<Label htmlFor="skill-library-search">
							Search known skill libraries
						</Label>
						<div className="flex gap-2">
							<Input
								id="skill-library-search"
								value={librarySearch}
								onChange={(e) => setLibrarySearch(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter" && librarySearch) {
										searchLibrary.mutate(librarySearch);
									}
								}}
								placeholder="e.g. commit message, pdf, code review"
							/>
							<Button
								variant="outline"
								onClick={() => searchLibrary.mutate(librarySearch)}
								disabled={searchLibrary.isPending || !librarySearch}
							>
								<Search className="size-4" />
								{searchLibrary.isPending ? "Searching…" : "Search"}
							</Button>
						</div>
						{searchLibrary.isError && (
							<p className="text-sm text-destructive">
								{(searchLibrary.error as Error).message}
							</p>
						)}

						{searchResults.length > 0 && (
							<div className="mt-2 rounded-lg border">
								<Table>
									<TableHeader>
										<TableRow className="hover:bg-transparent">
											<TableHead>Name</TableHead>
											<TableHead>Source</TableHead>
											<TableHead className="w-[100px]">Actions</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{searchResults.map((result) => (
											<TableRow key={result.rawUrl}>
												<TableCell className="font-medium">
													{result.name}
												</TableCell>
												<TableCell className="text-muted-foreground">
													{result.repo}
												</TableCell>
												<TableCell>
													<Button
														variant="ghost"
														size="sm"
														onClick={() =>
															importFromLibrary.mutate(result.rawUrl)
														}
														disabled={
															importFromLibrary.isPending &&
															importFromLibrary.variables === result.rawUrl
														}
													>
														Import
													</Button>
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</div>
						)}
						{searchLibrary.isSuccess && searchResults.length === 0 && (
							<p className="text-sm text-muted-foreground">
								No matching skills found.
							</p>
						)}
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>{isEditing ? "Edit skill" : "Create a skill"}</CardTitle>
					<CardDescription>
						Name and description are shown to the model to decide when to use
						this skill. The body is the instructions returned when it's
						invoked — write it like you'd brief a new teammate on how to do
						this one task.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="grid gap-2">
						<Label htmlFor="skill-name">Name</Label>
						<Input
							id="skill-name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="e.g. Write a commit message"
							disabled={isEditing}
						/>
						{isEditing && (
							<p className="text-xs text-muted-foreground">
								Renaming isn't supported yet — delete and recreate instead.
							</p>
						)}
					</div>

					<div className="grid gap-2">
						<Label htmlFor="skill-description">Description</Label>
						<Textarea
							id="skill-description"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder="What this skill does and when an agent should use it — shown to the model."
							rows={2}
						/>
					</div>

					<div className="grid gap-2">
						<Label htmlFor="skill-body">Instructions</Label>
						<Textarea
							id="skill-body"
							value={body}
							onChange={(e) => setBody(e.target.value)}
							placeholder="Step-by-step instructions the model reads when it invokes this skill."
							rows={10}
							className="font-mono text-sm"
						/>
					</div>

					<div className="flex items-center gap-3 border-t pt-4">
						<Button
							onClick={() => saveSkill.mutate()}
							disabled={
								saveSkill.isPending || !name || !description || !body
							}
						>
							{saveSkill.isPending
								? "Saving…"
								: isEditing
									? "Save changes"
									: "Create skill"}
						</Button>
						{isEditing && (
							<Button variant="ghost" onClick={resetForm}>
								Cancel
							</Button>
						)}
						{saveSkill.isError && (
							<p className="text-sm text-destructive">
								{(saveSkill.error as Error).message}
							</p>
						)}
					</div>
				</CardContent>
			</Card>

			<Dialog
				open={Boolean(deleteConfirmTarget)}
				onOpenChange={(open) => !open && setDeleteConfirmTarget(null)}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete skill</DialogTitle>
						<DialogDescription>
							This permanently deletes &quot;{deleteConfirmTarget?.name}&quot;. Agents
							referencing it will simply skip it. This action cannot be undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter showCloseButton>
						<Button
							variant="destructive"
							onClick={() => {
								if (deleteConfirmTarget?.slug) {
									deleteSkill.mutate(deleteConfirmTarget.slug);
									setDeleteConfirmTarget(null);
								}
							}}
							disabled={deleteSkill.isPending}
						>
							Delete
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
