import { Setting } from "obsidian";
import { renderInfoBox } from "./info-box.js";
import { wireAsyncButton } from "./async-button.js";
/**
 * Render the common Install-tab section shared by every Perspecta plugin:
 * an info box, a live status line, and an async "Install / Update agent skills"
 * button that refreshes the status when it completes.
 *
 * Suite convention (catalog §3.5): plugins expose post-install setup through a
 * settings Install tab. This centralises the info-box + status + async-button
 * pattern so the three plugins do not hand-roll it three different ways.
 */
export function renderInstallSection(containerEl, spec) {
    renderInfoBox(containerEl, {
        variant: "info",
        title: spec.title ?? "Agent skills",
        body: spec.body,
    });
    const statusEl = containerEl.createDiv({ cls: "perspecta-ui-install-status" });
    statusEl.setText("Checking install status…");
    const refresh = () => spec.status().then((s) => statusEl.setText(s));
    void refresh();
    new Setting(containerEl)
        .setName(spec.settingName ?? "Agent skills")
        .setDesc(spec.settingDesc)
        .addButton((button) => {
        wireAsyncButton(button, {
            label: spec.buttonLabel ?? "Install / Update agent skills",
            runningLabel: spec.runningLabel ?? "Installing…",
            cta: true,
            onClick: async () => {
                const result = await spec.install();
                const status = await spec.status();
                statusEl.setText(status);
                spec.onInstalled?.(result, status);
            },
            onError: spec.onError,
        });
    });
}
