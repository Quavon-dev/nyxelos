"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  type LeadScoutCampaignSummary,
  type LeadScoutDraftStatus,
  type LeadScoutEmailProvider,
  type LeadScoutLeadStatus,
  type LeadScoutLeadSummary,
  type LeadScoutProvider,
  type LeadScoutWebsiteStatus,
  trpcClient,
} from "@/lib/trpc";

const PROVIDER_LABEL: Record<LeadScoutProvider, string> = {
  manual_csv: "Manual CSV import",
  google_places_api: "Google Places API",
  osm_overpass: "OSM Overpass (free)",
  custom_api: "Custom API",
};

const WEBSITE_STATUS_BADGE: Record<LeadScoutWebsiteStatus, string> = {
  unknown: "bg-muted text-muted-foreground",
  has_website: "bg-emerald-500/15 text-emerald-600",
  missing_website: "bg-amber-500/15 text-amber-600",
  invalid_website: "bg-destructive/15 text-destructive",
};

const LEAD_STATUS_LABEL: Record<LeadScoutLeadStatus, string> = {
  new: "New",
  reviewed: "Reviewed",
  prototype_requested: "Prototype pending",
  prototype_ready: "Prototype ready",
  email_drafted: "Email draft pending",
  approved_to_send: "Approval pending",
  sending: "Sending",
  sent: "Sent",
  rejected: "Rejected",
  suppressed: "Suppressed",
};

const DRAFT_STATUS_LABEL: Record<LeadScoutDraftStatus, string> = {
  draft: "Draft",
  approved: "Approved — ready to send",
  rejected: "Rejected",
  sending: "Sending",
  sent: "Sent",
  failed: "Failed",
};

function CreateCampaignForm({
  workspaceId,
  onCreated,
}: {
  workspaceId: string;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("US");
  const [radiusKm, setRadiusKm] = useState("10");
  const [niches, setNiches] = useState("");
  const [maxResults, setMaxResults] = useState("25");
  const [provider, setProvider] = useState<LeadScoutProvider>("manual_csv");
  const [minConfidence, setMinConfidence] = useState("50");

  const createCampaign = useMutation({
    mutationFn: () =>
      trpcClient.leadScout.createCampaign.mutate({
        workspaceId,
        name,
        postalCode,
        country,
        radiusKm: Number(radiusKm),
        niches: niches
          .split(",")
          .map((n) => n.trim())
          .filter(Boolean),
        maxResultsPerRun: Number(maxResults),
        provider,
        minConfidence: Number(minConfidence),
      }),
    onSuccess: () => {
      setName("");
      setPostalCode("");
      setNiches("");
      onCreated();
    },
  });

  return (
    <div className="max-w-lg space-y-4 rounded-lg border p-5">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">New campaign</h3>
        <p className="text-xs text-muted-foreground">
          Finds local businesses with no website in a region, using a compliant source only. You are
          responsible for lawful outreach and consent requirements for whatever you contact.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="ls-name">Name</Label>
          <Input id="ls-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ls-postal">Postal code</Label>
          <Input
            id="ls-postal"
            value={postalCode}
            onChange={(e) => setPostalCode(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ls-country">Country</Label>
          <Input id="ls-country" value={country} onChange={(e) => setCountry(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ls-radius">Radius (km)</Label>
          <Input
            id="ls-radius"
            type="number"
            value={radiusKm}
            onChange={(e) => setRadiusKm(e.target.value)}
          />
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="ls-niches">Niches (comma-separated)</Label>
          <Input
            id="ls-niches"
            placeholder="plumber, bakery, hair salon"
            value={niches}
            onChange={(e) => setNiches(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ls-provider">Lead source</Label>
          <select
            id="ls-provider"
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            value={provider}
            onChange={(e) => setProvider(e.target.value as LeadScoutProvider)}
          >
            {Object.entries(PROVIDER_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ls-max">Max results/run</Label>
          <Input
            id="ls-max"
            type="number"
            value={maxResults}
            onChange={(e) => setMaxResults(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ls-confidence">Min confidence (0-100)</Label>
          <Input
            id="ls-confidence"
            type="number"
            value={minConfidence}
            onChange={(e) => setMinConfidence(e.target.value)}
          />
        </div>
      </div>
      {provider === "google_places_api" && (
        <p className="text-xs text-amber-600">
          You are responsible for complying with the Google Maps Platform Terms of Service for any
          data retrieved through this provider. Configure an API key in Source Settings first.
        </p>
      )}
      {createCampaign.error && (
        <p className="text-sm text-destructive">{(createCampaign.error as Error).message}</p>
      )}
      <Button
        size="sm"
        disabled={!name.trim() || !postalCode.trim() || createCampaign.isPending}
        onClick={() => createCampaign.mutate()}
      >
        {createCampaign.isPending ? "Creating…" : "Create campaign"}
      </Button>
    </div>
  );
}

function RunScanControl({ campaign }: { campaign: LeadScoutCampaignSummary }) {
  const queryClient = useQueryClient();
  const [csvText, setCsvText] = useState("");

  const runScan = useMutation({
    mutationFn: () =>
      trpcClient.leadScout.runScan.mutate({
        campaignId: campaign.id,
        csvText: campaign.provider === "manual_csv" ? csvText : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leadScout", "scanRuns", campaign.id] });
      queryClient.invalidateQueries({ queryKey: ["leadScout", "leads", campaign.id] });
    },
  });

  return (
    <div className="space-y-2 rounded-lg border p-4">
      <h3 className="text-sm font-medium">Run scan — {PROVIDER_LABEL[campaign.provider]}</h3>
      {campaign.provider === "manual_csv" ? (
        <>
          <p className="text-xs text-muted-foreground">
            CSV columns: businessName, address, postalCode, city, category, phone, email, website,
            notes.
          </p>
          <Textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder="businessName,address,postalCode,city,category,phone,email,website,notes"
            rows={4}
          />
        </>
      ) : null}
      {runScan.error && (
        <p className="text-sm text-destructive">{(runScan.error as Error).message}</p>
      )}
      {runScan.data && <p className="text-sm text-muted-foreground">{runScan.data.summary}</p>}
      <Button
        size="sm"
        disabled={runScan.isPending || (campaign.provider === "manual_csv" && !csvText.trim())}
        onClick={() => runScan.mutate()}
      >
        {runScan.isPending ? "Scanning…" : "Run scan"}
      </Button>
    </div>
  );
}

function PrototypeAndDraftPanel({ lead }: { lead: LeadScoutLeadSummary }) {
  const queryClient = useQueryClient();

  const prototypesQuery = useQuery({
    queryKey: ["leadScout", "prototypes", lead.id],
    queryFn: () => trpcClient.leadScout.listPrototypes.query({ leadId: lead.id }),
  });
  const draftsQuery = useQuery({
    queryKey: ["leadScout", "drafts", lead.id],
    queryFn: () => trpcClient.leadScout.listDrafts.query({ leadId: lead.id }),
  });

  const invalidateLead = () => {
    queryClient.invalidateQueries({ queryKey: ["leadScout", "prototypes", lead.id] });
    queryClient.invalidateQueries({ queryKey: ["leadScout", "drafts", lead.id] });
    queryClient.invalidateQueries({ queryKey: ["leadScout", "leads", lead.campaignId] });
  };

  const markReviewed = useMutation({
    mutationFn: () => trpcClient.leadScout.markLeadReviewed.mutate({ id: lead.id }),
    onSuccess: invalidateLead,
  });
  const generatePrototype = useMutation({
    mutationFn: () => trpcClient.leadScout.generatePrototype.mutate({ leadId: lead.id }),
    onSuccess: invalidateLead,
  });
  const approvePrototype = useMutation({
    mutationFn: (id: string) => trpcClient.leadScout.approvePrototype.mutate({ id }),
    onSuccess: invalidateLead,
  });
  const generateDraft = useMutation({
    mutationFn: () => trpcClient.leadScout.generateDraft.mutate({ leadId: lead.id }),
    onSuccess: invalidateLead,
  });
  const approveDraft = useMutation({
    mutationFn: (id: string) => trpcClient.leadScout.approveDraft.mutate({ id }),
    onSuccess: invalidateLead,
  });
  const rejectDraft = useMutation({
    mutationFn: (id: string) => trpcClient.leadScout.rejectDraft.mutate({ id }),
    onSuccess: invalidateLead,
  });
  const sendDraft = useMutation({
    mutationFn: (id: string) => trpcClient.leadScout.sendDraft.mutate({ id }),
    onSuccess: invalidateLead,
  });
  const resetForResend = useMutation({
    mutationFn: () => trpcClient.leadScout.resetLeadForResend.mutate({ id: lead.id }),
    onSuccess: invalidateLead,
  });

  const latestPrototype = prototypesQuery.data?.[0] ?? null;
  const latestDraft = draftsQuery.data?.[0] ?? null;
  const anyError = (markReviewed.error ??
    generatePrototype.error ??
    approvePrototype.error ??
    generateDraft.error ??
    approveDraft.error ??
    rejectDraft.error ??
    sendDraft.error ??
    resetForResend.error) as Error | undefined;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h4 className="text-sm font-medium">Evidence</h4>
        <p className="text-sm text-muted-foreground">
          {lead.evidenceSummary ?? "No evidence recorded."}
        </p>
        {lead.missingReason && (
          <p className="text-xs text-muted-foreground">
            Missing-website reason: {lead.missingReason}
          </p>
        )}
      </div>

      {anyError && <p className="text-sm text-destructive">{anyError.message}</p>}

      <div className="flex flex-wrap gap-2">
        {lead.status === "new" && (
          <Button
            size="sm"
            variant="outline"
            disabled={markReviewed.isPending}
            onClick={() => markReviewed.mutate()}
          >
            Mark reviewed
          </Button>
        )}
        {(lead.status === "new" || lead.status === "reviewed") && (
          <Button
            size="sm"
            disabled={generatePrototype.isPending}
            onClick={() => generatePrototype.mutate()}
          >
            {generatePrototype.isPending ? "Generating…" : "Generate prototype"}
          </Button>
        )}
        {lead.status === "sent" && (
          <Button
            size="sm"
            variant="outline"
            disabled={resetForResend.isPending}
            onClick={() => resetForResend.mutate()}
          >
            Reset for resend
          </Button>
        )}
      </div>

      {latestPrototype && (
        <div className="space-y-2 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">Prototype concept</h4>
            <Badge variant="outline">{latestPrototype.status}</Badge>
          </div>
          <p className="text-sm">{latestPrototype.concept}</p>
          {latestPrototype.heroCopy && (
            <p className="text-sm text-muted-foreground">Hero copy: {latestPrototype.heroCopy}</p>
          )}
          {latestPrototype.sections.length > 0 && (
            <p className="text-sm text-muted-foreground">
              Sections: {latestPrototype.sections.join(", ")}
            </p>
          )}
          {latestPrototype.callToAction && (
            <p className="text-sm text-muted-foreground">CTA: {latestPrototype.callToAction}</p>
          )}
          {latestPrototype.styleDirection && (
            <p className="text-sm text-muted-foreground">Style: {latestPrototype.styleDirection}</p>
          )}
          {latestPrototype.status === "ready" && !latestPrototype.approved && (
            <Button
              size="sm"
              disabled={approvePrototype.isPending}
              onClick={() => approvePrototype.mutate(latestPrototype.id)}
            >
              Approve prototype
            </Button>
          )}
          {latestPrototype.approved && lead.status === "prototype_ready" && (
            <Button
              size="sm"
              disabled={generateDraft.isPending}
              onClick={() => generateDraft.mutate()}
            >
              {generateDraft.isPending ? "Drafting…" : "Draft outreach email"}
            </Button>
          )}
        </div>
      )}

      {latestDraft && (
        <div className="space-y-2 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">Email draft</h4>
            <Badge variant="outline">{DRAFT_STATUS_LABEL[latestDraft.status]}</Badge>
          </div>
          <p className="text-sm font-medium">{latestDraft.subject}</p>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {latestDraft.bodyText}
          </p>
          {latestDraft.status === "draft" && (
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={approveDraft.isPending}
                onClick={() => approveDraft.mutate(latestDraft.id)}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={rejectDraft.isPending}
                onClick={() => rejectDraft.mutate(latestDraft.id)}
              >
                Reject
              </Button>
            </div>
          )}
          {latestDraft.status === "approved" && (
            <Button
              size="sm"
              disabled={sendDraft.isPending}
              onClick={() => sendDraft.mutate(latestDraft.id)}
            >
              {sendDraft.isPending ? "Sending…" : "Send"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function LeadDetailDialog({
  lead,
  onOpenChange,
}: {
  lead: LeadScoutLeadSummary | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={lead !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        {lead && (
          <>
            <DialogHeader>
              <DialogTitle>{lead.businessName}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                {lead.formattedAddress && <span>{lead.formattedAddress}</span>}
                {lead.phone && <span>· {lead.phone}</span>}
                {lead.email ? <span>· {lead.email}</span> : <span>· No email on file</span>}
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge className={WEBSITE_STATUS_BADGE[lead.websiteStatus]}>
                  {lead.websiteStatus.replace("_", " ")}
                </Badge>
                <Badge variant="outline">{LEAD_STATUS_LABEL[lead.status]}</Badge>
                <Badge variant="outline">Confidence {lead.confidence}</Badge>
              </div>
              <PrototypeAndDraftPanel lead={lead} />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function LeadsTable({ campaignId }: { campaignId: string }) {
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const leadsQuery = useQuery({
    queryKey: ["leadScout", "leads", campaignId],
    queryFn: () => trpcClient.leadScout.listLeads.query({ campaignId }),
  });
  const leads = leadsQuery.data ?? [];
  const selectedLead = leads.find((l) => l.id === selectedLeadId) ?? null;

  if (leadsQuery.isLoading) return <p className="text-sm text-muted-foreground">Loading leads…</p>;
  if (leads.length === 0) {
    return <p className="text-sm text-muted-foreground">No leads yet — run a scan to find some.</p>;
  }

  return (
    <div className="space-y-2">
      {leads.map((lead) => (
        <button
          key={lead.id}
          type="button"
          onClick={() => setSelectedLeadId(lead.id)}
          className="flex w-full items-center justify-between rounded-lg border p-3 text-left hover:bg-muted/50"
        >
          <div>
            <p className="text-sm font-medium">{lead.businessName}</p>
            <p className="text-xs text-muted-foreground">
              {lead.category ?? "Uncategorized"} · {lead.formattedAddress ?? "No address"}
            </p>
          </div>
          <div className="flex gap-2">
            <Badge className={WEBSITE_STATUS_BADGE[lead.websiteStatus]}>
              {lead.websiteStatus.replace("_", " ")}
            </Badge>
            <Badge variant="outline">{LEAD_STATUS_LABEL[lead.status]}</Badge>
          </div>
        </button>
      ))}
      <LeadDetailDialog
        lead={selectedLead}
        onOpenChange={(open) => !open && setSelectedLeadId(null)}
      />
    </div>
  );
}

function ScanRunsTable({ campaignId }: { campaignId: string }) {
  const runsQuery = useQuery({
    queryKey: ["leadScout", "scanRuns", campaignId],
    queryFn: () => trpcClient.leadScout.listScanRuns.query({ campaignId }),
  });
  const runs = runsQuery.data ?? [];
  if (runs.length === 0) {
    return <p className="text-sm text-muted-foreground">No scans run yet.</p>;
  }
  return (
    <div className="space-y-2">
      {runs.map((run) => (
        <div key={run.id} className="rounded-lg border p-3 text-sm">
          <div className="flex items-center justify-between">
            <Badge variant={run.status === "failed" ? "destructive" : "outline"}>
              {run.status}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {new Date(run.startedAt).toLocaleString()}
            </span>
          </div>
          <p className="mt-1 text-muted-foreground">
            {run.summary ?? run.errorMessage ?? "In progress…"}
          </p>
        </div>
      ))}
    </div>
  );
}

function SuppressionPanel({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");

  const suppressionsQuery = useQuery({
    queryKey: ["leadScout", "suppressions", workspaceId],
    queryFn: () => trpcClient.leadScout.listSuppressions.query({ workspaceId }),
  });
  const addSuppression = useMutation({
    mutationFn: () => trpcClient.leadScout.addSuppression.mutate({ workspaceId, email, reason }),
    onSuccess: () => {
      setEmail("");
      setReason("");
      queryClient.invalidateQueries({ queryKey: ["leadScout", "suppressions", workspaceId] });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="ls-suppress-email">Email to suppress</Label>
          <Input id="ls-suppress-email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ls-suppress-reason">Reason</Label>
          <Input
            id="ls-suppress-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <Button
          size="sm"
          disabled={!email.trim() || !reason.trim() || addSuppression.isPending}
          onClick={() => addSuppression.mutate()}
        >
          Add
        </Button>
      </div>
      <div className="space-y-2">
        {(suppressionsQuery.data ?? []).map((s) => (
          <div key={s.id} className="flex justify-between rounded-lg border p-3 text-sm">
            <span>{s.email ?? s.domain}</span>
            <span className="text-muted-foreground">{s.reason}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmailSettingsPanel({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["leadScout", "emailSettings", workspaceId],
    queryFn: () => trpcClient.leadScout.getEmailSettings.query({ workspaceId }),
  });
  const settings = settingsQuery.data;

  const [provider, setProvider] = useState<LeadScoutEmailProvider>(settings?.provider ?? "smtp");
  const [fromName, setFromName] = useState(settings?.fromName ?? "");
  const [fromEmail, setFromEmail] = useState(settings?.fromEmail ?? "");
  const [dryRunMode, setDryRunMode] = useState(settings?.dryRunMode ?? true);
  const [dailySendLimit, setDailySendLimit] = useState(String(settings?.dailySendLimit ?? 20));
  const [perCampaignSendLimit, setPerCampaignSendLimit] = useState(
    String(settings?.perCampaignSendLimit ?? 10),
  );
  const [legalFooter, setLegalFooter] = useState(settings?.legalFooter ?? "");
  const [testEmail, setTestEmail] = useState("");
  // Credentials are never returned by the server — leaving this blank on an
  // update keeps whatever's already configured (see upsertEmailSettings).
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [apiKey, setApiKey] = useState("");

  // useState's initial value only runs once — this query's data hasn't
  // loaded yet on first render, so the form fields need to be synced in
  // once it arrives. Keyed on settings?.id (stable across saves of the same
  // row) rather than `settings` itself, so it doesn't clobber an in-progress
  // edit on every background refetch.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally re-syncs only when the row identity changes, not on every field edit.
  useEffect(() => {
    if (!settings) return;
    setProvider(settings.provider);
    setFromName(settings.fromName);
    setFromEmail(settings.fromEmail);
    setDryRunMode(settings.dryRunMode);
    setDailySendLimit(String(settings.dailySendLimit));
    setPerCampaignSendLimit(String(settings.perCampaignSendLimit));
    setLegalFooter(settings.legalFooter ?? "");
  }, [settings?.id]);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["leadScout", "emailSettings", workspaceId] });

  const credentialsForProvider = (): Record<string, string> | undefined => {
    if (provider === "smtp") {
      return host ? { host, port, username, password } : undefined;
    }
    if (provider === "resend" || provider === "mailgun") {
      return apiKey ? { apiKey } : undefined;
    }
    return undefined;
  };

  const save = useMutation({
    mutationFn: () =>
      trpcClient.leadScout.upsertEmailSettings.mutate({
        workspaceId,
        provider,
        fromName,
        fromEmail,
        dryRunMode,
        dailySendLimit: Number(dailySendLimit),
        perCampaignSendLimit: Number(perCampaignSendLimit),
        legalFooter: legalFooter || null,
        credentials: credentialsForProvider(),
      }),
    onSuccess: invalidate,
  });
  const testConnection = useMutation({
    mutationFn: () => trpcClient.leadScout.testEmailConnection.mutate({ workspaceId }),
  });
  const sendTest = useMutation({
    mutationFn: () =>
      trpcClient.leadScout.sendTestEmail.mutate({ workspaceId, toEmail: testEmail }),
  });

  return (
    <div className="max-w-lg space-y-4 rounded-lg border p-5">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">Outreach email settings</h3>
        <p className="text-xs text-amber-600">
          You are responsible for lawful outreach and consent requirements. Sending is always
          approval-gated and defaults to dry-run mode.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ls-email-provider">Provider</Label>
        <select
          id="ls-email-provider"
          className="h-9 w-full rounded-md border bg-background px-2 text-sm"
          value={provider}
          onChange={(e) => setProvider(e.target.value as LeadScoutEmailProvider)}
        >
          <option value="smtp">SMTP</option>
          <option value="resend">Resend</option>
          <option value="mailgun">Mailgun</option>
          <option value="custom">Custom</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="ls-from-name">From name</Label>
          <Input id="ls-from-name" value={fromName} onChange={(e) => setFromName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ls-from-email">From email</Label>
          <Input
            id="ls-from-email"
            value={fromEmail}
            onChange={(e) => setFromEmail(e.target.value)}
          />
        </div>
      </div>

      {provider === "smtp" && (
        <div className="grid grid-cols-2 gap-3">
          <Input placeholder="SMTP host" value={host} onChange={(e) => setHost(e.target.value)} />
          <Input placeholder="Port" value={port} onChange={(e) => setPort(e.target.value)} />
          <Input
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <Input
            placeholder="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
      )}
      {(provider === "resend" || provider === "mailgun") && (
        <Input
          placeholder="API key"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
      )}
      {settings?.hasCredentials && (
        <p className="text-xs text-muted-foreground">
          Credentials are already configured — leave the fields above blank to keep them unchanged.
        </p>
      )}

      <div className="flex items-center justify-between rounded-lg border p-3">
        <div>
          <p className="text-sm font-medium">Dry run mode</p>
          <p className="text-xs text-muted-foreground">
            Simulates sends without dispatching real email.
          </p>
        </div>
        <Switch checked={dryRunMode} onCheckedChange={setDryRunMode} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Daily send limit</Label>
          <Input
            type="number"
            value={dailySendLimit}
            onChange={(e) => setDailySendLimit(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Per-campaign send limit</Label>
          <Input
            type="number"
            value={perCampaignSendLimit}
            onChange={(e) => setPerCampaignSendLimit(e.target.value)}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Legal footer</Label>
        <Textarea value={legalFooter} onChange={(e) => setLegalFooter(e.target.value)} rows={2} />
      </div>

      {save.error && <p className="text-sm text-destructive">{(save.error as Error).message}</p>}
      <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
        {save.isPending ? "Saving…" : "Save settings"}
      </Button>

      <div className="space-y-2 border-t pt-4">
        <Button
          size="sm"
          variant="outline"
          disabled={testConnection.isPending}
          onClick={() => testConnection.mutate()}
        >
          Test connection
        </Button>
        {testConnection.data && (
          <p
            className={`text-sm ${testConnection.data.ok ? "text-emerald-600" : "text-destructive"}`}
          >
            {testConnection.data.message}
          </p>
        )}
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <Label>Send test email to</Label>
            <Input value={testEmail} onChange={(e) => setTestEmail(e.target.value)} />
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!testEmail.trim() || sendTest.isPending}
            onClick={() => sendTest.mutate()}
          >
            Send test
          </Button>
        </div>
        {sendTest.data && (
          <p className="text-sm text-muted-foreground">
            {sendTest.data.dryRun ? "Dry run — nothing was actually sent." : "Test email sent."}
          </p>
        )}
      </div>
    </div>
  );
}

function CampaignDashboard({ campaign }: { campaign: LeadScoutCampaignSummary }) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-4 text-sm text-muted-foreground">
        {campaign.postalCode}, {campaign.country} · {campaign.radiusKm}km ·{" "}
        {campaign.niches.join(", ") || "any niche"} · min confidence {campaign.minConfidence} ·{" "}
        {campaign.outreachMode === "draft_only" ? "Draft-only" : "Review & send"}
      </div>
      <RunScanControl campaign={campaign} />
      <Tabs defaultValue="leads">
        <TabsList>
          <TabsTrigger value="leads">Leads</TabsTrigger>
          <TabsTrigger value="scans">Scan history</TabsTrigger>
          <TabsTrigger value="suppression">Suppression</TabsTrigger>
        </TabsList>
        <TabsContent value="leads" className="mt-4">
          <LeadsTable campaignId={campaign.id} />
        </TabsContent>
        <TabsContent value="scans" className="mt-4">
          <ScanRunsTable campaignId={campaign.id} />
        </TabsContent>
        <TabsContent value="suppression" className="mt-4">
          <SuppressionPanel workspaceId={campaign.workspaceId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function LocalLeadScoutExtensionPage({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);

  const campaignsQuery = useQuery({
    queryKey: ["leadScout", "campaigns", workspaceId],
    queryFn: () => trpcClient.leadScout.listCampaigns.query({ workspaceId }),
  });
  const campaigns = campaignsQuery.data ?? [];
  const activeCampaign = campaigns.find((c) => c.id === selectedCampaignId) ?? campaigns[0] ?? null;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6 md:p-8">
      <PageHeader
        title="Local Lead Scout"
        description="Find local businesses with no website, review a generated prototype and outreach email, and approve before anything is sent."
      />

      <Tabs defaultValue="campaigns">
        <TabsList>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="email-settings">Email settings</TabsTrigger>
        </TabsList>
        <TabsContent value="campaigns" className="mt-4 space-y-4">
          {campaigns.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {campaigns.map((c) => (
                <Button
                  key={c.id}
                  size="sm"
                  variant={c.id === activeCampaign?.id ? "default" : "outline"}
                  onClick={() => setSelectedCampaignId(c.id)}
                >
                  {c.name}
                </Button>
              ))}
            </div>
          )}
          {activeCampaign ? (
            <CampaignDashboard campaign={activeCampaign} />
          ) : (
            <CreateCampaignForm
              workspaceId={workspaceId}
              onCreated={() =>
                queryClient.invalidateQueries({ queryKey: ["leadScout", "campaigns", workspaceId] })
              }
            />
          )}
          {activeCampaign && campaigns.length < 10 && (
            <details className="rounded-lg border p-4">
              <summary className="cursor-pointer text-sm font-medium">New campaign</summary>
              <div className="mt-4">
                <CreateCampaignForm
                  workspaceId={workspaceId}
                  onCreated={() =>
                    queryClient.invalidateQueries({
                      queryKey: ["leadScout", "campaigns", workspaceId],
                    })
                  }
                />
              </div>
            </details>
          )}
        </TabsContent>
        <TabsContent value="email-settings" className="mt-4">
          <EmailSettingsPanel workspaceId={workspaceId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
