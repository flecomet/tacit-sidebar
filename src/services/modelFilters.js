/** Filters, groups and price labels for the model picker. Pure; reads normalized model objects. */
import { isFreePricing } from './modelCatalog';

export const MODALITIES = ['text', 'image', 'file', 'audio', 'video'];

export const getModalities = (model) => {
    const arch = model?.architecture;
    const input = Array.isArray(arch?.input_modalities) ? arch.input_modalities
        : typeof model?.supportsImages === 'boolean' ? (model.supportsImages ? ['text', 'image'] : ['text'])
            : null;
    const output = Array.isArray(arch?.output_modalities) ? arch.output_modalities : null;
    return { input, output };
};

/** The company behind the model: OpenRouter ids start with it ("anthropic/..."); direct providers are their own vendor. */
export const getModelVendor = (model, provider) =>
    provider === 'openrouter' && model.id.includes('/') ? model.id.split('/')[0] : provider;

const hasAll = (have, wanted) => !wanted.length || (!!have && wanted.every(x => have.includes(x)));

/** A model with unknown modalities is hidden only while a filter on that dimension is on. */
export const filterModels = (models, { input = [], output = [], vendors = [], freeOnly = false } = {}, provider) =>
    models.filter(m => {
        const mods = getModalities(m);
        return hasAll(mods.input, input)
            && hasAll(mods.output, output)
            && (!vendors.length || vendors.includes(getModelVendor(m, provider)))
            && (!freeOnly || isFreePricing(m.pricing));
    });

const rank = (x) => { const i = MODALITIES.indexOf(x); return i === -1 ? MODALITIES.length : i; };

export const filterOptions = (models, provider) => {
    const inputs = new Set();
    const outputs = new Set();
    const vendors = new Set();
    let hasFree = false;
    for (const m of models) {
        const { input, output } = getModalities(m);
        input?.forEach(x => inputs.add(x));
        output?.forEach(x => outputs.add(x));
        vendors.add(getModelVendor(m, provider));
        if (isFreePricing(m.pricing)) hasFree = true;
    }
    const ordered = (set) => [...set].sort((a, b) => rank(a) - rank(b));
    return { inputs: ordered(inputs), outputs: ordered(outputs), vendors: [...vendors].sort(), hasFree };
};

const MONTH = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Newest month first; models without a date (some Google models) last, in their original order. */
export const groupByReleaseMonth = (models) => {
    const sorted = [...models].sort((a, b) => (b.created || 0) - (a.created || 0));
    const groups = [];
    for (const m of sorted) {
        const label = m.created ? MONTH.format(new Date(m.created * 1000)) : 'Undated';
        const last = groups[groups.length - 1];
        if (last && last.label === label) last.models.push(m);
        else groups.push({ label, models: [m] });
    }
    return groups;
};

const perMillion = (perToken) => {
    const n = Number(perToken) * 1e6;
    if (!Number.isFinite(n) || n < 0) return null;
    return n >= 1 ? String(Number(n.toFixed(2))) : String(Number(n.toPrecision(2)));
};

/** "$2/$10" = input / output price per million tokens. */
export const formatPrice = (pricing) => {
    if (!pricing) return '';
    if (isFreePricing(pricing)) return 'Free';
    const p = perMillion(pricing.prompt);
    const c = perMillion(pricing.completion);
    return p !== null && c !== null ? `$${p}/$${c}` : '';
};
