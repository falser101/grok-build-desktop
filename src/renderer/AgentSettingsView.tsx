import { useCallback, useEffect, useState } from "react";
import type {
  InstallerChannel,
  InstallerResult,
  InstallerStatus,
} from "@shared/types";
import { OptionCard } from "./SettingsView";
import type { Messages } from "./i18n";

type UpdateCheck = {
  hasUpdate: boolean;
  current: string;
  latest: string;
};

interface AgentSettingsViewProps {
  status: InstallerStatus;
  channel: InstallerChannel;
  lastCheck?: string;
  m: Messages;
}

const CHANNELS: InstallerChannel[] = ["stable", "alpha", "enterprise"];

function statusLabel(
  status: InstallerStatus,
  m: Messages,
): { label: string; tone: "ok" | "warn" | "danger" | "neutral" } {
  switch (status.kind) {
    case "absent":
      return { label: m.agentStatusAbsent, tone: "warn" };
    case "ready":
      return { label: `${m.agentStatusReady} · v${status.version}`, tone: "ok" };
    case "update-available":
      return {
        label: `${m.agentStatusUpdateAvailable}: v${status.current} → v${status.latest}`,
        tone: "warn",
      };
    case "installing":
      return { label: m.agentStatusInstalling, tone: "neutral" };
    case "upgrading":
      return {
        label: `${m.agentStatusUpgrading} (${status.from} → ${status.to})`,
        tone: "neutral",
      };
    case "rollback":
      return {
        label: `${m.agentStatusRollback}: ${status.reason}`,
        tone: "danger",
      };
    case "error":
      return { label: `${m.agentStatusError}: ${status.message}`, tone: "danger" };
  }
}

function formatRelative(iso?: string): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const deltaMs = Date.now() - t;
  const sec = Math.max(1, Math.round(deltaMs / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  return new Date(t).toLocaleDateString();
}

export function AgentSettingsView({
  status,
  channel,
  lastCheck,
  m,
}: AgentSettingsViewProps) {
  const [busy, setBusy] = useState<"install" | "upgrade" | "check" | null>(
    null,
  );
  const [result, setResult] = useState<InstallerResult | null>(null);
  const [checkInfo, setCheckInfo] = useState<UpdateCheck | null>(null);

  const isBusy =
    busy !== null ||
    status.kind === "installing" ||
    status.kind === "upgrading";

  const runInstall = useCallback(async () => {
    setBusy("install");
    setResult(null);
    try {
      const r = await window.desktop.installAgent();
      setResult(r);
      if (r.ok) {
        // After install, fire a fresh update probe so the UI shows
        // the now-installed version side-by-side with latest.
        const c = await window.desktop.checkForUpdate().catch(() => null);
        if (c) setCheckInfo(c);
      }
    } finally {
      setBusy(null);
    }
  }, []);

  const runUpgrade = useCallback(async () => {
    setBusy("upgrade");
    setResult(null);
    try {
      const r = await window.desktop.upgradeAgent();
      setResult(r);
    } finally {
      setBusy(null);
    }
  }, []);

  const runCheck = useCallback(async () => {
    setBusy("check");
    setResult(null);
    try {
      const c = await window.desktop.checkForUpdate();
      setCheckInfo(c);
    } catch (err) {
      setResult({
        ok: false,
        output: "",
        code: null,
        durationMs: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(null);
    }
  }, []);

  const onSelectChannel = useCallback(async (c: InstallerChannel) => {
    await window.desktop.setInstallerChannel(c).catch((err) => {
      setResult({
        ok: false,
        output: "",
        code: null,
        durationMs: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, []);

  const meta = statusLabel(status, m);
  const hasBinary =
    status.kind === "ready" ||
    status.kind === "update-available" ||
    status.kind === "rollback";
  const canInstall =
    !isBusy &&
    (status.kind === "absent" ||
      status.kind === "error" ||
      // Allow re-install from "rollback": we already rolled back the
      // previous try so the user can retry by invoking the official
      // installer again.
      status.kind === "rollback");
  const canUpgrade =
    !isBusy &&
    hasBinary &&
    (status.kind === "update-available" || (checkInfo?.hasUpdate ?? false));
  const canCheck = !isBusy; // Probing works in every state, including absent.

  // Reset stale results when the status transitions to something terminal.
  useEffect(() => {
    if (
      status.kind === "ready" ||
      status.kind === "absent" ||
      status.kind === "update-available"
    ) {
      // Keep the result pane visible until the next user action; just
      // don't auto-clear it so the user can read the last output.
    }
  }, [status.kind]);

  return (
    <section className="settings-card">
      <div className="settings-card-head">
        <h2>{m.agentSectionTitle}</h2>
        <p>{m.agentSectionSubtitle}</p>
      </div>

      <div className="settings-info-list">
        <InfoRowLite
          label={m.agentStatusLabel}
          value={
            <span className={`installer-status installer-status-${meta.tone}`}>
              {meta.label}
            </span>
          }
        />
        {hasBinary ? (
          <InfoRowLite
            label={m.agentInstallPathLabel}
            value={
              <code className="installer-path">
                {status.kind === "rollback"
                  ? "(see log)"
                  : "path" in status
                    ? status.path
                    : ""}
              </code>
            }
          />
        ) : null}
        <InfoRowLite
          label={m.agentLastCheckLabel}
          value={formatRelative(lastCheck)}
        />
        {checkInfo ? (
          <InfoRowLite
            label={m.agentLatestVersionLabel}
            value={
              checkInfo.hasUpdate
                ? `${checkInfo.latest} (${m.agentStatusUpdateAvailable.toLowerCase()})`
                : checkInfo.latest || "—"
            }
          />
        ) : null}
      </div>

      <div className="settings-card-head" style={{ marginBottom: 8 }}>
        <h3 className="settings-subhead">{m.agentChannelTitle}</h3>
      </div>
      <div
        className="settings-options"
        role="radiogroup"
        aria-label={m.agentChannelTitle}
      >
        {CHANNELS.map((c) => (
          <OptionCard
            key={c}
            value={c}
            selected={channel === c}
            title={
              c === "stable"
                ? m.agentChannelStable
                : c === "alpha"
                  ? m.agentChannelAlpha
                  : m.agentChannelEnterprise
            }
            description={
              c === "stable" ? m.agentChannelStableDesc : undefined
            }
            onSelect={(v: string) => void onSelectChannel(v as InstallerChannel)}
          />
        ))}
      </div>

      <div className="settings-card-actions">
        <button
          type="button"
          className="settings-btn"
          disabled={!canCheck}
          onClick={() => void runCheck()}
        >
          {busy === "check" ? m.agentChecking : m.agentCheckUpdate}
        </button>
        <button
          type="button"
          className="settings-btn primary"
          disabled={!canInstall}
          onClick={() => void runInstall()}
          title={
            canInstall
              ? undefined
              : m.agentInstallHint ?? undefined
          }
        >
          {busy === "install" || status.kind === "installing"
            ? m.agentInstallRunning
            : m.agentInstall}
        </button>
        <button
          type="button"
          className="settings-btn primary"
          disabled={!canUpgrade}
          onClick={() => void runUpgrade()}
          title={
            canUpgrade
              ? undefined
              : (checkInfo?.hasUpdate ?? false)
                ? m.agentUpgradeReady
                : m.agentNoUpdate
          }
        >
          {busy === "upgrade" || status.kind === "upgrading"
            ? m.agentUpgrading
            : status.kind === "update-available"
              ? `${m.agentUpgrade} → v${status.latest}`
              : checkInfo?.hasUpdate
                ? `${m.agentUpgrade} → v${checkInfo.latest}`
                : m.agentUpgrade}
        </button>
      </div>

      {result ? (
        <pre
          className={
            "settings-output" +
            (result.ok ? " settings-output-ok" : " settings-output-fail")
          }
        >
          {result.ok
            ? m.agentUpgradeSuccess.replace("{path}", result.path ?? "")
            : `${m.agentUpgradeFailed}\n${result.error ?? ""}\n\n${result.output}`}
        </pre>
      ) : null}
    </section>
  );
}

function InfoRowLite({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="settings-info-row">
      <span className="settings-info-label">{label}</span>
      <span className="settings-info-value">{value}</span>
    </div>
  );
}