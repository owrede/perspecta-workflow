import { App, Modal, Setting } from "obsidian";

/** Show a yes/no confirmation dialog. Resolves true when the user confirms,
 *  false on cancel or close (Escape / click-away). `body` may contain newlines;
 *  each line is rendered as its own paragraph. `confirmText` labels (and
 *  warning-styles) the confirm button — e.g. "Delete", "Change". */
export function confirmModal(
  app: App,
  title: string,
  body: string,
  confirmText = "Confirm",
): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = new Modal(app);
    let decided = false;
    modal.titleEl.setText(title);
    for (const line of body.split("\n")) modal.contentEl.createEl("p", { text: line });
    new Setting(modal.contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => modal.close()))
      .addButton((b) =>
        b
          .setButtonText(confirmText)
          .setWarning()
          .onClick(() => {
            decided = true;
            modal.close();
            resolve(true);
          }),
      );
    modal.onClose = () => {
      if (!decided) resolve(false);
    };
    modal.open();
  });
}
