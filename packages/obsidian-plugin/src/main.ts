import { Plugin } from "obsidian";
import { VERSION } from "@perspecta/core";

export default class PerspectaWorkflowPlugin extends Plugin {
  async onload() {
    console.log(`Perspecta Workflow plugin v${VERSION} loaded`);
  }
}
