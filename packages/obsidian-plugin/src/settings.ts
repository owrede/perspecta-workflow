import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import {
  PerspectaSettingsStore,
  renderSettingsShell,
  renderInstallSection,
  renderInfoBox,
  wiredText,
  wiredToggle,
} from "perspecta-ui";
import { applyGroupPermission, setToolPermission, groupIsUniform, resolveToolPermission, serverGroupDefaults, type McpRegistry, type McpToolGroup, type McpToolPermission } from "@perspecta/core";
import type PerspectaWorkflowPlugin from "./main.js";
import { bundledSkillWrites } from "./skills/bundledSkills.js";
import { CHANGELOG } from "./changelog.generated.js";

export interface PerspectaSettings {
  nodeFolder: string;
  autoColor: boolean;
  mcpRegistry: McpRegistry;
}

export const DEFAULT_SETTINGS: PerspectaSettings = {
  nodeFolder: "workflows",
  autoColor: true,
  mcpRegistry: {},
};

/** Synthetic dropdown value meaning "the group's tools are not uniform" — shown
 *  (and selected, as a no-op) only when there's a deviation. Not a real permission. */
const GROUP_CUSTOM_SENTINEL = "__custom__";

export class PerspectaSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: PerspectaWorkflowPlugin) {
    super(app, plugin);
  }

  /** MCP tab view state: the server list, or one server's permission sub-screen. */
  private mcpView: { mode: "list" } | { mode: "detail"; server: string } = { mode: "list" };

  display(): void {
    // Reopen the settings panel on the server list, not a stale detail sub-screen.
    this.mcpView = { mode: "list" };
    const store = this.plugin.settingsStore;
    renderSettingsShell(this.containerEl, {
      plugin: this.plugin,
      displayName: "Perspecta Workflow",
      changelog: CHANGELOG,
      defaultTab: "general",
      tabs: [
        {
          id: "general",
          label: "General",
          render: (el) => {
            wiredText(new Setting(el), store, {
              key: "nodeFolder",
              name: "Node note folder",
              desc: "Where inserted WorkflowNode notes are created.",
            });
            wiredToggle(new Setting(el), store, {
              key: "autoColor",
              name: "Auto-color workflow nodes",
              desc: "Automatically color nodes by type when a workflow canvas opens or changes.",
            });
          },
        },
        {
          id: "install",
          label: "Install",
          render: (el) => {
            // Bundled static skills plus the generated generic workflow skill.
            const total = bundledSkillWrites().length + 1;
            renderInstallSection<number>(el, {
              body: "Install or update the skills that let agents discover and run Perspecta workflows in this vault.",
              settingDesc: "Writes plugin-owned skills to .claude/skills (one per .pflow under _agents/) and updates the vault CLAUDE.md pointer block.",
              status: async () => {
                const s = await this.plugin.agentInstallStatus();
                return `Installed skills: ${s.installedSkills}/${total}. CLAUDE.md pointer: ${s.hasPointer ? "yes" : "no"}.`;
              },
              install: () => this.plugin.installAgentSkills(),
              onInstalled: (count) => {
                new Notice(`Perspecta Workflow: installed agent skills for ${count} workflow${count === 1 ? "" : "s"}`);
              },
              onError: (err) => new Notice(`Perspecta Workflow: install failed - ${(err as Error).message}`),
            });

            // Connect a coding agent to the bundled MCP server. Resolving the
            // server path is async, so append the row when it resolves — same
            // void-an-inner-async approach the MCP tab uses for renderMcpTab.
            void this.renderMcpSetupRow(el);
          },
        },
        {
          id: "mcp",
          label: "MCP",
          render: (el) => {
            void this.renderMcpTab(el);
          },
        },
      ],
      debugTab: {
        render: (el) => {
          renderInfoBox(el, {
            variant: "info",
            title: "Diagnostics",
            body: `Auto-color is ${store.get("autoColor") ? "on" : "off"}. Node folder: ${store.get("nodeFolder")}.`,
          });
        },
      },
    });
  }

  private async renderMcpSetupRow(el: HTMLElement): Promise<void> {
    const setup = await this.plugin.mcpSetupPrompt();
    const row = new Setting(el)
      .setName("Import the agent's MCP servers")
      .setDesc(
        "reason" in setup
          ? setup.reason
          : "Copies a prompt to paste into a coding agent running in this vault. The agent records every MCP server it has configured into this vault's .mcp.json (including the bundled perspecta-workflow server) so the MCP tab can manage them all.",
      );
    row.addButton((btn) => {
      btn.setButtonText("Copy import prompt");
      if ("reason" in setup) {
        btn.setDisabled(true).setTooltip(setup.reason);
      } else {
        btn.setCta().onClick(async () => {
          // clipboard.writeText can reject (denied permission, Electron quirks);
          // the framework does not await this handler, so catch it ourselves and
          // surface the failure rather than leaving an unhandled rejection.
          try {
            await navigator.clipboard.writeText(setup.prompt);
            new Notice("Import prompt copied — paste it into your coding agent running in this vault.");
          } catch {
            new Notice("Perspecta Workflow: could not write to clipboard.");
          }
        });
      }
    });
  }

  private async renderMcpTab(el: HTMLElement): Promise<void> {
    el.empty();
    if (this.mcpView.mode === "detail") {
      await this.renderMcpDetail(el, this.mcpView.server);
      return;
    }
    const plugin = this.plugin;
    const servers = await plugin.listMcpServers();
    if (servers.length === 0) {
      renderInfoBox(el, { variant: "info", title: "No MCP servers", body: "No .mcp.json found at the vault root, or it declares no servers." });
      return;
    }
    const enabled = servers.filter((s) => plugin.settings.mcpRegistry[s.name]?.whitelisted);
    const available = servers.filter((s) => !plugin.settings.mcpRegistry[s.name]?.whitelisted);

    const toggleRow = (s: { name: string }, group: HTMLElement) => {
      const reg = plugin.settings.mcpRegistry[s.name];
      const statusWord = reg?.probe.status === "hot" ? "enabled"
        : reg?.probe.status === "probing" ? "probing"
        : reg?.probe.status === "failed" ? `failed${reg.probe.error ? ` — ${reg.probe.error}` : ""}`
        : reg?.probe.status === "cold" ? "not probed yet"
        : "not enabled";
      const row = new Setting(group).setName(s.name).setDesc(statusWord);
      row.addToggle((t) =>
        t.setValue(!!reg?.whitelisted).onChange(async (v) => {
          if (v) {
            await plugin.probeMcpServer(s.name);
          } else {
            const next = { ...plugin.settings.mcpRegistry };
            delete next[s.name];
            plugin.settings.mcpRegistry = next;
            await plugin.saveSettings();
          }
          await this.renderMcpTab(el);
        }),
      );
      if (reg?.whitelisted && reg.probe.status === "hot") {
        row.addExtraButton((b) =>
          b.setIcon("refresh-cw").setTooltip("Re-probe").onClick(async () => {
            await plugin.probeMcpServer(s.name);
            await this.renderMcpTab(el);
          }),
        );
        row.addButton((btn) =>
          btn.setButtonText("Permissions").onClick(() => {
            this.mcpView = { mode: "detail", server: s.name };
            void this.renderMcpTab(el);
          }),
        );
      }
    };

    if (enabled.length) {
      new Setting(el).setName("Enabled").setHeading();
      for (const s of enabled) toggleRow(s, el);
    }
    if (available.length) {
      new Setting(el).setName("Available").setHeading();
      for (const s of available) toggleRow(s, el);
    }
  }

  private async renderMcpDetail(el: HTMLElement, serverName: string): Promise<void> {
    const plugin = this.plugin;
    const reg = plugin.settings.mcpRegistry[serverName];
    new Setting(el).addButton((b) =>
      b.setButtonText("‹ Back to servers").onClick(() => {
        this.mcpView = { mode: "list" };
        void this.renderMcpTab(el);
      }),
    );
    if (!reg || reg.probe.status !== "hot") {
      renderInfoBox(el, { variant: "info", title: serverName, body: "This server is not enabled or has not been probed." });
      return;
    }
    new Setting(el).setName(`${serverName} — tool permissions`).setHeading()
      .setDesc("Choose when the agent may use these tools.");
    const GROUPS: { key: McpToolGroup; label: string }[] = [
      { key: "read", label: "Read-only tools" },
      { key: "interactive", label: "Interactive tools" },
      { key: "write", label: "Write / delete tools" },
    ];
    for (const { key, label } of GROUPS) this.renderPermissionGroup(el, serverName, key, label);
  }

  private renderPermissionGroup(el: HTMLElement, serverName: string, group: McpToolGroup, label: string): void {
    const plugin = this.plugin;
    const reg = plugin.settings.mcpRegistry[serverName];
    const toolNames = Object.keys(reg.tools).filter((n) => reg.tools[n].group === group).sort();
    if (toolNames.length === 0) return;

    const uniform = groupIsUniform(reg, group);
    const groupDefault = serverGroupDefaults(reg)[group];
    new Setting(el).setName(`${label} (${toolNames.length})`).setHeading()
      .addDropdown((d) => {
        d.addOption("allow", "Always allow");
        d.addOption("ask", "Permission required");
        d.addOption("blocked", "Blocked");
        if (!uniform) d.addOption(GROUP_CUSTOM_SENTINEL, "— Custom");
        d.setValue(uniform ? groupDefault : GROUP_CUSTOM_SENTINEL);
        d.onChange(async (v) => {
          if (v === GROUP_CUSTOM_SENTINEL) return;
          // `reg` (captured at render) is safe: every mutation re-renders via
          // renderMcpTab → el.empty(), so this closure can't fire against stale state.
          plugin.settings.mcpRegistry[serverName] = applyGroupPermission(reg, group, v as McpToolPermission);
          await plugin.saveSettings();
          await this.renderMcpTab(el);
        });
      });

    const ICONS: { perm: McpToolPermission; icon: string; tip: string }[] = [
      { perm: "allow", icon: "circle-check", tip: "Always allow" },
      { perm: "ask", icon: "hand", tip: "Permission required" },
      { perm: "blocked", icon: "ban", tip: "Blocked" },
    ];
    for (const tool of toolNames) {
      const resolved = resolveToolPermission(reg, tool);
      const row = new Setting(el).setName(tool).setDesc(reg.tools[tool].description ?? "");
      if (resolved === "blocked") row.settingEl.addClass("perspecta-mcp-tool-blocked");
      for (const { perm, icon, tip } of ICONS) {
        row.addExtraButton((b) => {
          b.setIcon(icon).setTooltip(tip);
          if (resolved === perm) b.extraSettingsEl.addClass("perspecta-mcp-perm-active");
          b.onClick(async () => {
            plugin.settings.mcpRegistry[serverName] = setToolPermission(plugin.settings.mcpRegistry[serverName], tool, perm);
            await plugin.saveSettings();
            await this.renderMcpTab(el);
          });
        });
      }
    }
  }
}
