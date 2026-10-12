import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from './useChatStore';

describe('persisted sort and favorites-first', () => {
    const { version, migrate, partialize, merge } = useChatStore.persist.getOptions();

    beforeEach(() => {
        useChatStore.setState({ modelSort: { key: 'default', dir: 'asc' }, favoritesFirst: false });
    });

    it('is stored at schema version 5', () => {
        expect(version).toBe(5);
    });

    it('defaults older saved state to the default order', () => {
        const migrated = migrate({ model: 'x', favorites: [] }, 4);
        expect(migrated.modelSort).toEqual({ key: 'default', dir: 'asc' });
        expect(migrated.favoritesFirst).toBe(false);
    });

    it('keeps a sort choice that is already saved at version 5', () => {
        expect(migrate({ modelSort: { key: 'name', dir: 'desc' } }, 5).modelSort).toEqual({ key: 'name', dir: 'desc' });
    });

    it('is included in the persisted fields', () => {
        useChatStore.setState({ modelSort: { key: 'price', dir: 'asc' }, favoritesFirst: true });
        const saved = partialize(useChatStore.getState());
        expect(saved.modelSort).toEqual({ key: 'price', dir: 'asc' });
        expect(saved.favoritesFirst).toBe(true);
    });

    it('exposes a setModelSort action and a setFavoritesFirst action', () => {
        useChatStore.getState().setModelSort({ key: 'released', dir: 'desc' });
        useChatStore.getState().setFavoritesFirst(true);
        expect(useChatStore.getState().modelSort).toEqual({ key: 'released', dir: 'desc' });
        expect(useChatStore.getState().favoritesFirst).toBe(true);
    });

    it('falls back to the default order when a saved sort value is malformed', () => {
        const current = useChatStore.getState();
        const loaded = merge({ modelSort: 'name', favoritesFirst: 'yes' }, current);
        expect(loaded.modelSort).toEqual({ key: 'default', dir: 'asc' });
        expect(loaded.favoritesFirst).toBe(false);
    });

    it('falls back to the default order for an unknown sort key or direction', () => {
        const current = useChatStore.getState();
        const loaded = merge({ modelSort: { key: 'bogus', dir: 'sideways' }, favoritesFirst: true }, current);
        expect(loaded.modelSort).toEqual({ key: 'default', dir: 'asc' });
        expect(loaded.favoritesFirst).toBe(true);
    });

    // A recognized key must not silently become that key ascending when its direction is malformed.
    it.each([
        ['name', 'sideways'],
        ['released', 'junk'],
        ['price', undefined],
    ])('falls back to the default order for a recognized %s key with a malformed direction', (key, dir) => {
        const current = useChatStore.getState();
        const loaded = merge({ modelSort: { key, dir }, favoritesFirst: false }, current);
        expect(loaded.modelSort).toEqual({ key: 'default', dir: 'asc' });
    });

    it('keeps a valid saved sort through the merge', () => {
        const current = useChatStore.getState();
        const loaded = merge({ modelSort: { key: 'price', dir: 'desc' }, favoritesFirst: false }, current);
        expect(loaded.modelSort).toEqual({ key: 'price', dir: 'desc' });
    });
});
