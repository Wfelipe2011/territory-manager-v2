// test/utils/base-builder.ts

/**
 * Classe base genérica para Test Data Builders.
 * Permite a criação fluente de objetos para testes.
 */
export abstract class BaseBuilder<T> {
    protected _data: T;

    constructor(defaultData: T) {
        // Clona o objeto para garantir imutabilidade entre testes
        this._data = JSON.parse(JSON.stringify(defaultData));
    }

    /**
     * Atualiza propriedades genéricas do objeto.
     * Útil para alterações rápidas sem criar um método específico.
     */
    public with(data: Partial<T>): this {
        this._data = { ...this._data, ...data };
        return this;
    }

    /**
     * Retorna o objeto construído.
     */
    public build(): T {
        return this._data;
    }
}