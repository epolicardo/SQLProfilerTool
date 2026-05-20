
import * as vscode from 'vscode';
import * as os from 'os';
import { TelemetryReporter } from '@vscode/extension-telemetry';

export class TelemetryService {
    private static instance: TelemetryService | undefined;
    private reporter: TelemetryReporter | undefined;
    private isEnabled: boolean = false;
    private commonProperties: { [key: string]: string } = {};

    private constructor(context: vscode.ExtensionContext, connectionStringOrKey: string) {
        // Respeta la configuración global y la de la extensión
        const config = vscode.workspace.getConfiguration('sqlProfiler');
        const userOptIn = config.get<boolean>('telemetryEnabled', true);
        // Compatibilidad máxima: usar isTelemetryEnabled
        const globalOptIn = typeof vscode.env.isTelemetryEnabled === 'boolean' ? vscode.env.isTelemetryEnabled : true;
        this.isEnabled = userOptIn && globalOptIn;

        // Set common properties that will be included in all events
        this.commonProperties = {
            osPlatform: os.platform(),
            osType: os.type(),
            osArch: os.arch(),
            vscodeVersion: vscode.version,
            vscodeLanguage: vscode.env.language,
            vscodeRemoteName: vscode.env.remoteName || 'local',
            vscodeUiKind: vscode.env.uiKind === vscode.UIKind.Desktop ? 'desktop' : 'web',
            extensionVersion: context.extension.packageJSON.version,
            nodeVersion: process.version,
            nodeArch: process.arch
        };

        if (this.isEnabled) {
            // Acepta connection string completo o solo el key
            const connectionString = connectionStringOrKey.includes('InstrumentationKey=')
                ? connectionStringOrKey
                : `InstrumentationKey=${connectionStringOrKey}`;
            this.reporter = new TelemetryReporter(connectionString);
            context.subscriptions.push(this.reporter);
        }
    }

    public static initialize(context: vscode.ExtensionContext, key: string) {
        if (!TelemetryService.instance) {
            TelemetryService.instance = new TelemetryService(context, key);
        }
        return TelemetryService.instance;
    }

    public static getInstance(): TelemetryService | undefined {
        return TelemetryService.instance;
    }

    public sendEvent(eventName: string, properties?: { [key: string]: string }) {
        if (this.isEnabled && this.reporter) {
            // Merge common properties with event-specific properties
            const allProperties = { ...this.commonProperties, ...properties };
            this.reporter.sendTelemetryEvent(eventName, allProperties);
        }
    }

    public sendError(eventName: string, error: Error) {
        if (this.isEnabled && this.reporter) {
            // Sanear el mensaje de error antes de enviarlo
            const sanitized = error.message.replace(/(Server=.*?;)|(User Id=.*?;)|(Password=.*?;)/gi, '');
            const errorProperties = { ...this.commonProperties, message: sanitized };
            this.reporter.sendTelemetryErrorEvent(eventName, errorProperties);
        }
    }

    public sendMetric(eventName: string, value: number, properties?: { [key: string]: string }) {
        if (this.isEnabled && this.reporter) {
            // Enviar como evento con el valor como propiedad, incluyendo common properties
            const eventProperties = { ...this.commonProperties, ...properties, value: value.toString() };
            this.reporter.sendTelemetryEvent(eventName, eventProperties);
        }
    }

    public dispose() {
        this.reporter?.dispose();
    }
}
