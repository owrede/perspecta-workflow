import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import {
  PerspectaSettingsStore,
  renderSettingsShell,
  renderInstallSection,
  renderInfoBox,
  wiredText,
  wiredToggle,
} from "perspecta-ui";
import { applyGroupPermission, type McpRegistry, type McpToolGroup, type McpToolPermission } from "@perspecta/core";
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

export class PerspectaSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: PerspectaWorkflowPlugin) {
    super(app, plugin);
  }

  display(): void {
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
              body: "Install or update the skills and workflow index that let agents discover and run Perspecta workflows in this vault.",
              settingDesc: "Writes plugin-owned skills to .claude/skills, rebuilds _agents/workflows/INDEX.md, and updates the vault CLAUDE.md pointer block.",
              status: async () => {
                const s = await this.plugin.agentInstallStatus();
                return `Installed skills: ${s.installedSkills}/${total}. Registry: ${s.hasRegistry ? "yes" : "no"}. CLAUDE.md pointer: ${s.hasPointer ? "yes" : "no"}.`;
              },
              install: () => this.plugin.installAgentSkills(),
              onInstalled: (count) => {
                new Notice(`Perspecta Workflow: installed agent skills and indexed ${count} workflow${count === 1 ? "" : "s"}`);
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
      .setName("Connect a coding agent (MCP)")
      .setDesc(
        "reason" in setup
          ? setup.reason
          : "Copies a prompt to paste into a coding agent running in this vault. It registers the bundled perspecta-workflow MCP server so the agent can run your workflows.",
      );
    row.addButton((btn) => {
      btn.setButtonText("Copy setup prompt");
      if ("reason" in setup) {
        btn.setDisabled(true);
      } else {
        btn.setCta().onClick(async () => {
          await navigator.clipboard.writeText(setup.prompt);
          new Notice("Setup prompt copied — paste it into your coding agent running in this vault.");
        });
      }
    });
  }

  private async renderMcpTab(el: HTMLElement): Promise<void> {
    el.empty();
    const plugin = this.plugin;
    const servers = await plugin.listMcpServers();
    if (servers.length === 0) {
      renderInfoBox(el, { variant: "info", title: "No MCP servers", body: "No .mcp.json found at the vault root, or it declares no servers." });
      return;
    }
    for (const s of servers) {
      const reg = plugin.settings.mcpRegistry[s.name];
      const status = reg?.probe.status ?? "cold";
      const desc = reg?.whitelisted ? `${status}${reg.probe.error ? ` — ${reg.probe.error}` : ""}` : "not whitelisted";
      const head = new Setting(el).setName(s.name).setDesc(desc);
      head.addToggle((t) =>
        t.setValue(!!reg?.whitelisted).onChange(async (v) => {
          if (v) {
            await plugin.probeMcpServer(s.name);
          } else {
            const next = { ...plugin.settings.mcpRegistry };
            delete next[s.name];
            plugin.settings.mcpRegistry = next;
            await plugin.saveSettings();
          }
          await this.renderMcpTab(el); // re-render this tab in place
        }),
      );
      if (reg?.whitelisted && reg.probe.status === "hot") {
        head.addExtraButton((b) =>
          b.setIcon("refresh-cw").setTooltip("Re-probe").onClick(async () => {
            await plugin.probeMcpServer(s.name);
            await this.renderMcpTab(el);
          }),
        );
        for (const group of ["read", "write"] as McpToolGroup[]) {
          const groupTools = Object.entries(reg.tools).filter(([, t]) => t.group === group);
          if (groupTools.length === 0) continue;
          const groupHead = new Setting(el).setName(group === "read" ? "Read tools" : "Write tools").setHeading();
          groupHead.addButton((btn) =>
            btn.setButtonText("Block all").onClick(async () => {
              plugin.settings.mcpRegistry[s.name] = applyGroupPermission(plugin.settings.mcpRegistry[s.name], group, "blocked");
              await plugin.saveSettings();
              await this.renderMcpTab(el);
            }),
          );
          for (const [tool, t] of groupTools) {
            new Setting(el).setName(tool).setDesc(t.description ?? "").addDropdown((d) =>
              d.addOptions({ blocked: "Blocked", ask: "Ask", allow: "Always allow" })
                .setValue(t.permission)
                .onChange(async (v) => {
                  plugin.settings.mcpRegistry[s.name].tools[tool].permission = v as McpToolPermission;
                  await plugin.saveSettings();
                }),
            );
          }
        }
      }
    }
  }
}
