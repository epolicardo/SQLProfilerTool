import * as vscode from 'vscode';

export class ProfilerViewProvider implements vscode.TreeDataProvider<ProfilerItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ProfilerItem | undefined | null | void> = new vscode.EventEmitter<ProfilerItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ProfilerItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private isProfilerRunning: boolean = false;
    private currentConnection: string | undefined;
    private eventCount: number = 0;

    constructor() { }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    updateStatus(running: boolean, connection?: string, eventCount?: number): void {
        this.isProfilerRunning = running;
        if (connection !== undefined) {
            this.currentConnection = connection;
        }
        if (eventCount !== undefined) {
            this.eventCount = eventCount;
        }
        this.refresh();
    }

    getTreeItem(element: ProfilerItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ProfilerItem): Thenable<ProfilerItem[]> {
        // Return empty to show viewsWelcome content with the button
        return Promise.resolve([]);
    }
}

class ProfilerItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly tooltip: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: string,
        public readonly command?: vscode.Command
    ) {
        super(label, collapsibleState);
        this.tooltip = tooltip;
        this.contextValue = contextValue;
        if (command) {
            this.command = command;
        }
    }
}
