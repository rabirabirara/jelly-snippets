import {
	App,
	Editor,
	EditorPosition,
	MarkdownView,
	Plugin,
	PluginSettingTab,
	Setting,
} from "obsidian";

enum AutoTriggerOptions {
	Disabled = "disabled",
	EnabledNoWS = "n-ws",
	EnabledYesWS = "y-ws",
}

enum SnippetType {
	SLSR = 0,
	SLMR = 1,
	MLSR = 2,
	MLMR = 3,
}

interface JellySnippetsSettings {
	snippetsFile: string;
	triggerOnSpace: AutoTriggerOptions;
	triggerOnEnter: AutoTriggerOptions;
	triggerOnTab: AutoTriggerOptions;
	snippetPartDivider: string;
	snippetDivider: string;
}

const DEFAULT_SETTINGS: JellySnippetsSettings = {
	snippetsFile: String.raw`Snip me! |+| Snippet successfully replaced.
-==-
- |+| #####
-==-
: |+| -
-==-
:: |+| hi`,
	triggerOnSpace: AutoTriggerOptions.Disabled,
	triggerOnEnter: AutoTriggerOptions.Disabled,
	triggerOnTab: AutoTriggerOptions.Disabled,
	snippetPartDivider: " |+| ",
	snippetDivider: "-==-",
};

// TODO: Add semantic symbols to represent certain special characters.
// TODO: Also implement those semantic symbols for control characters.
// Specifically, allow me to add a "whitespace" symbol so that I can put newlines in snippets if I need.

export default class JellySnippets extends Plugin {
	settings: JellySnippetsSettings;
	private multilineSnippets: { [key: string]: string } = {};

	async onload() {
		await this.loadSettings();

		// Check settings and load snippets in.
		this.reloadSnippets();

		// If keydown events are set...
		if (
			this.settings.triggerOnSpace !== AutoTriggerOptions.Disabled ||
			this.settings.triggerOnTab !== AutoTriggerOptions.Disabled ||
			this.settings.triggerOnEnter !== AutoTriggerOptions.Disabled
		) {
			const onKeyEvent = (evt: KeyboardEvent) => {
				if (
					!evt.shiftKey // TODO: add function to determine when not to trigger. don't trigger if shift is pressed down as well e.g.
				) {
					const mdFile = this.app.workspace.activeEditor;
					if (mdFile?.editor) {
						this.triggerSnippetAutomatically(mdFile.editor, evt);
					}
				}
			};

			// Register for main window.
			this.registerDomEvent(document, "keydown", onKeyEvent);

			// If window changes, registerDomEvent for new window if so.
			this.registerEvent(
				this.app.workspace.on("window-open", (event) => {
					this.registerDomEvent(activeWindow, "keydown", onKeyEvent);
				})
			);
		}

		this.addCommand({
			id: "trigger-snippet",
			name: "Trigger snippet",
			editorCallback: (editor: Editor) => {
				this.triggerSnippet(editor);
			},
		});

		this.addCommand({
			id: "reload-snippets",
			name: "Reload snippets",
			callback: () => {
				this.reloadSnippets();
			},
		});

		this.addSettingTab(new JellySnippetsSettingTab(this.app, this));
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	reloadSnippets(): void {
		console.log("Jelly Snippets: Reloading snippets.");
		this.multilineSnippets = {};
		this.parseSnippets();
	}

	parseSnippets(): void {
		// If they specified newline control character, split snippets by newline.
		// ! If so, there can be no multiline snippets!
		let snippetDivider =
			this.settings.snippetDivider == "\\n"
				? "\n"
				: this.settings.snippetDivider;

		// go through the snippets file, split by the snippet divider, split by the part divider, put in map
		let snippetLines = this.settings.snippetsFile.split(snippetDivider);
		snippetLines.forEach((snippet, index) => {
			// Trim newlines. Instead, use symbols to let people insert whitespace.
			let snippetParts = snippet
				.trim()
				.split(this.settings.snippetPartDivider);
			let lhs = snippetParts.shift();
			let rhs = snippetParts.join(this.settings.snippetPartDivider);
			if (lhs === undefined) {
				console.log("Failed to register snippet: ", snippet);
			} else {
				this.multilineSnippets[lhs] = rhs;
			}
		});
	}

	triggerSnippet(
		editor: Editor,
		pos?: EditorPosition
	): [string, string] | undefined {
		let curpos = pos ? pos : editor.getCursor();
		return this.triggerMultilineSnippet(editor, curpos);
	}

	triggerSnippetAutomatically(editor: Editor, evt: KeyboardEvent) {
		// remember the order: enter and tab come out before code triggers, space comes out after.
		switch (evt.key) {
			case " ": {
				if (
					this.settings.triggerOnSpace !== AutoTriggerOptions.Disabled
				) {
					if (this.triggerSnippet(editor)) {
						// Currently impossible to undo the space because the entire snippet
						// and all this code triggers before the space actually happens.
						return true;
					}
				}
				break;
			}
			case "Tab": {
				if (
					this.settings.triggerOnTab === AutoTriggerOptions.Disabled
				) {
					return false;
				}
				editor.exec("indentLess");
				let maybeSnippet = this.triggerSnippet(editor);
				if (maybeSnippet) {
					if (
						this.settings.triggerOnTab ===
						AutoTriggerOptions.EnabledYesWS
					) {
						if (
							this.getSnippetType(maybeSnippet) ===
							SnippetType.SLSR
						) {
							editor.exec("indentMore");
						}
					}
					return true;
				} else {
					// If no snippet was triggered, restore the user's indent!
					editor.exec("indentMore");
				}
				break;
			}
			case "Enter": {
				if (
					this.settings.triggerOnEnter === AutoTriggerOptions.Disabled
				) {
					return false;
				}
				// Since the newline comes out first, we need to track where our old position was before newline.
				let curpos = editor.getCursor();
				let aboveline = curpos.line - 1;
				let abovelineEnd = editor.getLine(aboveline).length;
				let peekPos: EditorPosition = {
					line: aboveline,
					ch: abovelineEnd,
				};
				let maybeSnippet = this.triggerSnippet(editor, peekPos);
				if (maybeSnippet) {
					let snippetType = this.getSnippetType(maybeSnippet);
					if (
						this.settings.triggerOnEnter ===
						AutoTriggerOptions.EnabledNoWS
					) {
						// NoWS
						if (snippetType === SnippetType.MLSR) {
							// RCNN - do nothing
						} else {
							// RCNDMU - delete from curpos to start of next line
							let curpos = editor.getCursor();
							let nextLine = curpos.line + 1;
							let nextLineStartPos: EditorPosition = {
								line: nextLine,
								ch: 0,
							};
							editor.replaceRange("", curpos, nextLineStartPos);
						}
					} else {
						// YesWS
						let curpos = editor.getCursor();
						if (snippetType === SnippetType.MLSR) {
							// RCNN - insert newline ("repeat enter") / replace curpos with  newline
							editor.exec("newlineAndIndent");
							editor.exec("indentLess");
						} else {
							// RCNDMU - move to start of next line / to the right
							editor.exec("goRight");

							// * To calculate it:
							// let nextLine = curpos.line + 1;
							// let nextLineStartPos: EditorPosition = {
							// 	line: nextLine,
							// 	ch: 0,
							// };
							// editor.setCursor(nextLineStartPos);
						}
					}

					return true;
				} else {
					// Didn't trigger; move the cursor back down
					editor.setCursor(curpos);
				}
				break;
			}
			default: {
				break;
			}
		}
		return false;
	}

	triggerMultilineSnippet(
		editor: Editor,
		pos?: EditorPosition
	): [string, string] | undefined {
		const curpos = pos ? pos : editor.getCursor();

		for (let [lhs, rhs] of Object.entries(this.multilineSnippets)) {
			if (!this.selectBackN(editor, lhs.length, curpos)) {
				// console.log(
				// 	"Error: failed to select back N at: " +
				// 		pos +
				// 		" with lhs: " +
				// 		lhs
				// );
				continue;
			}

			// If the selected string is the LHS, replace it!
			let selected = editor.getSelection();
			if (lhs === selected) {
				editor.replaceSelection(rhs);

				// Reset selection to where the cursor is *after* replacement.
				// Allows "enabled-with-whitespace" auto replacements to work.
				this.unselect(editor);
				return [lhs, rhs];
			}

			// Reset selection to where the cursor is.
			this.unselect(editor, curpos);
		}

		return;
	}

	// Motivation:
	// Single snippets (no newlines) and multi snippets (newlines)
	// have different, weird interaction with Obsidian. Sometimes the whitespace goes through, sometimes not.
	// There needs to be a way of determining what type (mlhs->srhs? mlhs->mrhs? slhs? srhs? etc.) a snippet is.
	getSnippetType(snippet: [string, string]): SnippetType {
		let [lhs, rhs] = snippet;
		let type = SnippetType.SLSR;
		// Compiler doesn't complain if we convert boolean to number with unary '+'.
		type |= +lhs.contains("\n") && SnippetType.MLSR;
		type |= +rhs.contains("\n") && SnippetType.SLMR;
		return type;
	}

	selectBackN(editor: Editor, N: number, pos?: EditorPosition): boolean {
		const curpos = pos ? pos : editor.getCursor();

		// pos -> offset; offset - N; offsetToPos; select offsets
		let endOffset = editor.posToOffset(curpos);
		let startOffset = endOffset - N;

		// If we can't select back N because we are too close to the start:
		if (startOffset < 0) {
			return false;
		}

		// * In selection terms, anchor is where you first click and head is where you drag to.
		// Try to keep head at the end position and anchor at the start.
		let startPos = editor.offsetToPos(startOffset);
		let endPos = editor.offsetToPos(endOffset);
		editor.setSelection(startPos, endPos);
		return true;
	}

	unselect(editor: Editor, pos?: EditorPosition) {
		if (pos) editor.setSelection(pos, pos);
		else editor.setSelection(editor.getCursor(), editor.getCursor());
	}
}

class JellySnippetsSettingTab extends PluginSettingTab {
	plugin: JellySnippets;

	constructor(app: App, plugin: JellySnippets) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		let childEl = containerEl.createDiv({ cls: "jelly_snippets" });

		childEl.createEl("h2", { text: "Jelly Snippets - Settings" });

		new Setting(childEl)
			.setName("Snippets")
			.setDesc(
				"Specify your snippets here! Format: 'before<divider>after'. Surrounding your divider with a space is recommended for readability."
			)
			.addTextArea((textarea) =>
				textarea
					.setPlaceholder(
						`before${this.plugin.settings.snippetPartDivider}after`
					)
					.setValue(this.plugin.settings.snippetsFile)
					.onChange(async (value) => {
						this.plugin.settings.snippetsFile = value;
						await this.plugin.saveSettings();
						this.plugin.reloadSnippets(); // ? is this necessary to update the snippets?
					})
			);

		new Setting(childEl)
			.setName("Snippet line divider")
			.setDesc(
				"This string will divide each separate snippet definition. (Enter the two characters '\\n' to use newlines as your separator.)"
			)
			.addText((text) =>
				text
					.setPlaceholder("-==-")
					.setValue(this.plugin.settings.snippetDivider)
					.onChange(async (value) => {
						this.plugin.settings.snippetDivider = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(childEl)
			.setName("Snippet part divider")
			.setDesc(
				"This string will divide the lhs and rhs of a snippet definition. (I recommend putting spaces in the ends of this string.)"
			)
			.addText((text) =>
				text
					.setPlaceholder(" |+| ")
					.setValue(this.plugin.settings.snippetPartDivider)
					.onChange(async (value) => {
						this.plugin.settings.snippetPartDivider = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(childEl)
			.setName("Trigger on Space")
			.setDesc(
				"If enabled, the snippet function will trigger when space is pressed (but not while shift is held)."
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption(AutoTriggerOptions.Disabled, "Disabled")
					// .addOption(AutoTriggerOptions.EnabledNoWS, "Enabled, no whitespace")
					.addOption(
						AutoTriggerOptions.EnabledYesWS,
						"Enabled, also space"
					)
					.setValue(this.plugin.settings.triggerOnSpace)
					.onChange(async (value) => {
						this.plugin.settings.triggerOnSpace =
							value as AutoTriggerOptions;
						await this.plugin.saveSettings();
					})
			);

		new Setting(childEl)
			.setName("Trigger on Enter")
			.setDesc(
				"If enabled, the snippet function will trigger when enter is pressed (but not while shift is held)."
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption(AutoTriggerOptions.Disabled, "Disabled")
					.addOption(
						AutoTriggerOptions.EnabledNoWS,
						"Enabled, no newline"
					)
					.addOption(
						AutoTriggerOptions.EnabledYesWS,
						"Enabled, also newline"
					)
					.setValue(this.plugin.settings.triggerOnEnter)
					.onChange(async (value) => {
						this.plugin.settings.triggerOnEnter =
							value as AutoTriggerOptions;
						await this.plugin.saveSettings();
					})
			);

		new Setting(childEl)
			.setName("Trigger on Tab")
			.setDesc(
				"If enabled, the snippet function will trigger when tab is pressed (but not while shift is held)."
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption(AutoTriggerOptions.Disabled, "Disabled")
					.addOption(
						AutoTriggerOptions.EnabledNoWS,
						"Enabled, no indent"
					)
					.addOption(
						AutoTriggerOptions.EnabledYesWS,
						"Enabled, also indent on simple snippets (no newlines)"
					)
					.setValue(this.plugin.settings.triggerOnTab)
					.onChange(async (value) => {
						this.plugin.settings.triggerOnTab =
							value as AutoTriggerOptions;
						await this.plugin.saveSettings();
					})
			);
	}
}
