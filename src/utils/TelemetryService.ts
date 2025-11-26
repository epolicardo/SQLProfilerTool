
import * as vscode from 'vscode';
import { TelemetryReporter } from '@vscode/extension-telemetry';

export class TelemetryService {
    private static instance: TelemetryService | undefined;
    private reporter: TelemetryReporter | undefined;
    private isEnabled: boolean = false;

    private constructor(context: vscode.ExtensionContext, key: string) {
        // Respeta la configuración global y la de la extensión
        const config = vscode.workspace.getConfiguration('sqlProfiler');
        const userOptIn = config.get<boolean>('telemetryEnabled', true);
        // Compatibilidad máxima: usar isTelemetryEnabled
        const globalOptIn = typeof vscode.env.isTelemetryEnabled === 'boolean' ? vscode.env.isTelemetryEnabled : true;
        this.isEnabled = userOptIn && globalOptIn;
        if (this.isEnabled) {
            // Nueva API de TelemetryReporter usa connection string en formato:
            // InstrumentationKey=<key>;IngestionEndpoint=https://westus2-2.in.applicationinsights.azure.com/
            const connectionString = `InstrumentationKey=${key}`;
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
            this.reporter.sendTelemetryEvent(eventName, properties);
        }
    }

    public sendError(eventName: string, error: Error) {
        if (this.isEnabled && this.reporter) {
            // Sanear el mensaje de error antes de enviarlo
            const sanitized = error.message.replace(/(Server=.*?;)|(User Id=.*?;)|(Password=.*?;)/gi, '');
            this.reporter.sendTelemetryErrorEvent(eventName, { message: sanitized });
        }
    }

    public sendMetric(eventName: string, value: number, properties?: { [key: string]: string }) {
        if (this.isEnabled && this.reporter) {
            // Enviar como evento con el valor como propiedad
            const eventProperties = { ...properties, value: value.toString() };
            this.reporter.sendTelemetryEvent(eventName, eventProperties);
        }
    }

    public dispose() {
        this.reporter?.dispose();
    }
}
