/** Filters, groups and price labels for the model picker. Pure; reads normalized model objects. */
import { parseModelPrice } from './modelCatalog';

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

const EXTRA_CHARGE_KEYS = ['request', 'image', 'audio', 'input_audio', 'output_audio'];

/** USD cost of a 10,000-token input plus 2,000-token output; null when a text price is missing or invalid. */
export const getReferenceCost = (pricing) => {
    const input = parseModelPrice(pricing?.prompt);
    const output = parseModelPrice(pricing?.completion);
    if (input === null || output === null) return null;
    return input * 10000 + output * 2000;
};

/**
 * Price tier from catalogue pricing only (never model names or size). Reference cost in USD for a
 * 10,000-token input plus 2,000-token output: below $0.01 budget, below $0.10 mid, otherwise high.
 * Zero text prices with a non-zero extra charge, or any missing/invalid price, are 'unknown'.
 * A 'free' tier does not guarantee that a whole operation costs zero.
 */
export const getPriceTier = (pricing) => {
    const cost = getReferenceCost(pricing);
    if (cost === null) return 'unknown';
    if (EXTRA_CHARGE_KEYS.some(key => pricing[key] != null && parseModelPrice(pricing[key]) !== 0)) return 'unknown';
    if (cost === 0) return 'free';
    return cost < 0.01 ? 'budget' : cost < 0.10 ? 'mid' : 'high';
};

const hasAll = (have, wanted) => !wanted.length || (!!have && wanted.every(x => have.includes(x)));

/** A model with unknown modalities is hidden only while a filter on that dimension is on. */
export const filterModels = (models, { input = [], output = [], vendors = [], priceTier = 'all' } = {}, provider) =>
    models.filter(m => {
        const mods = getModalities(m);
        return hasAll(mods.input, input)
            && hasAll(mods.output, output)
            && (!vendors.length || vendors.includes(getModelVendor(m, provider)))
            && (priceTier === 'all' || getPriceTier(m.pricing) === priceTier);
    });

const rank = (x) => { const i = MODALITIES.indexOf(x); return i === -1 ? MODALITIES.length : i; };

/** Facet values present in the list. `priceTiers` counts models per tier, zero included, with the filter's classifier. */
export const filterOptions = (models, provider) => {
    const inputs = new Set();
    const outputs = new Set();
    const vendors = new Set();
    const priceTiers = { free: 0, budget: 0, mid: 0, high: 0, unknown: 0 };
    for (const m of models) {
        const { input, output } = getModalities(m);
        input?.forEach(x => inputs.add(x));
        output?.forEach(x => outputs.add(x));
        vendors.add(getModelVendor(m, provider));
        priceTiers[getPriceTier(m.pricing)] += 1;
    }
    const ordered = (set) => [...set].sort((a, b) => rank(a) - rank(b));
    return { inputs: ordered(inputs), outputs: ordered(outputs), vendors: [...vendors].sort(), priceTiers };
};

export const DEFAULT_SORT = { key: 'default', dir: 'asc' };

/** UTC month number (year * 12 + month) for a Unix-seconds timestamp, or null when undated. */
const createdMonth = (m) => {
    if (!m.created) return null;
    const d = new Date(m.created * 1000);
    return d.getUTCFullYear() * 12 + d.getUTCMonth();
};

const byName = (a, b) =>
    (a.name || a.id).localeCompare(b.name || b.id, 'en', { sensitivity: 'base', numeric: true }) || a.id.localeCompare(b.id);

const byId = (a, b) => a.id.localeCompare(b.id);

/**
 * Sorts a copy of the models.
 * - `name` is locale-aware, numeric and flips with the direction.
 * - `price` sorts by the tier classifier's cost; models with no value go last in both directions and
 *   equal prices break by model ID in a fixed direction, so names never decide a tie.
 * - `released` sorts by UTC month (not the exact timestamp), keeps the input order inside a month,
 *   and puts undated models last in their original order. The 'default' key keeps the input order.
 */
export const sortModels = (models, { key = 'default', dir = 'asc' } = {}) => {
    const sign = dir === 'asc' ? 1 : -1;
    if (key === 'default') return [...models];
    if (key === 'name') return [...models].sort((a, b) => sign * byName(a, b));
    if (key === 'released') return [...models].sort((a, b) => {
        const x = createdMonth(a);
        const y = createdMonth(b);
        if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
        return sign * (x - y);
    });
    if (key === 'price') return [...models].sort((a, b) => {
        const x = getPriceTier(a.pricing) === 'unknown' ? null : getReferenceCost(a.pricing);
        const y = getPriceTier(b.pricing) === 'unknown' ? null : getReferenceCost(b.pricing);
        if (x === null || y === null) return x === y ? byId(a, b) : x === null ? 1 : -1;
        return x === y ? byId(a, b) : sign * (x - y);
    });
    return [...models];
};

const MONTH = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * Newest month first by default; models inside a month keep their descending-timestamp order and undated
 * models come last in their original order. `dir === 'asc'` reverses the dated month groups of that default
 * grouping, leaves each group's model order untouched, and keeps Undated last.
 */
export const groupByReleaseMonth = (models, dir = 'desc') => {
    const sorted = [...models].sort((a, b) => (b.created || 0) - (a.created || 0));
    const groups = [];
    for (const m of sorted) {
        const label = m.created ? MONTH.format(new Date(m.created * 1000)) : 'Undated';
        const last = groups[groups.length - 1];
        if (last && last.label === label) last.models.push(m);
        else groups.push({ label, models: [m] });
    }
    if (dir !== 'asc') return groups;
    const dated = groups.filter(g => g.label !== 'Undated');
    const undated = groups.filter(g => g.label === 'Undated');
    return [...dated.reverse(), ...undated];
};

const perMillion = (perToken) => {
    const price = parseModelPrice(perToken);
    if (price === null) return null;
    const n = price * 1e6;
    return n >= 1 ? String(Number(n.toFixed(2))) : String(Number(n.toPrecision(2)));
};

/** "$2/$10" = input / output price per million tokens. */
export const formatPrice = (pricing) => {
    if (!pricing) return '';
    // "Free" follows the tier classifier, so a zero text price with a non-zero extra charge
    // (classified 'unknown') still shows its per-million prices.
    if (getPriceTier(pricing) === 'free') return 'Free';
    const p = perMillion(pricing.prompt);
    const c = perMillion(pricing.completion);
    return p !== null && c !== null ? `$${p}/$${c}` : '';
};
