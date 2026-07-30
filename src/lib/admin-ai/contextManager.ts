export type CRMContext = {
    module: string;
    metrics?: Record<string, any>;
    filters?: Record<string, any>;
    rows?: any[];
    totalRows?: number;
    selectedRow?: any;
    [key: string]: any;
};

class ContextManager {
    private context: CRMContext | null = null;
    private listeners: Set<(ctx: CRMContext | null) => void> = new Set();

    update(newContext: CRMContext) {
        this.context = { ...this.context, ...newContext };
        this.notify();
    }

    set(newContext: CRMContext | null) {
        this.context = newContext;
        this.notify();
    }

    get(): CRMContext | null {
        return this.context;
    }

    subscribe(listener: (ctx: CRMContext | null) => void) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notify() {
        this.listeners.forEach((l) => l(this.context));
    }
}

export const CRMContextManager = new ContextManager();
