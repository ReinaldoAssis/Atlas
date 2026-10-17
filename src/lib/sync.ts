/**
 * Cliente do sync P2P (comandos Rust + eventos).
 *
 * Carregável fora do Tauri (preview web): as funções só chamam `invoke` quando
 * o app está empacotado. A UI usa `syncSupported()` para esconder a seção.
 */

import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { activeDbName } from './test-mode';
import { m } from './paraglide/messages.js';

export interface SyncPeerStatus {
	endpointId: string;
	name: string;
	lastSyncAt: number;
}

export interface SyncPendingPair {
	endpointId: string;
	name: string;
	sas: string;
}

export interface SyncStatus {
	enabled: boolean;
	running: boolean;
	endpointId: string | null;
	peers: SyncPeerStatus[];
	pendingPairs: SyncPendingPair[];
}

export interface SyncDiscovered {
	endpointId: string;
	name: string;
	address: string | null;
	paired: boolean;
}

export interface PairStarted {
	peer: string;
	sas: string;
}

export interface SyncApplied {
	peer: string;
	applied: number;
	skipped: number;
	at: number;
}

export interface PairRequest {
	peer: string;
	name: string;
	sas: string;
}

export interface Paired {
	peer: string;
	name: string;
}

export function syncSupported(): boolean {
	return isTauri();
}

export function syncStatus(): Promise<SyncStatus> {
	return invoke<SyncStatus>('sync_status', { db: activeDbName() });
}

export function syncStart(): Promise<SyncStatus> {
	return invoke<SyncStatus>('sync_start', { db: activeDbName() });
}

export function syncStop(): Promise<SyncStatus> {
	return invoke<SyncStatus>('sync_stop', { db: activeDbName() });
}

export function syncNow(): Promise<SyncStatus> {
	return invoke<SyncStatus>('sync_now', { db: activeDbName() });
}

export function syncDiscovered(): Promise<SyncDiscovered[]> {
	return invoke<SyncDiscovered[]>('sync_discovered', { db: activeDbName() });
}

/** `address` em `ip:porta` só é usada quando o par não está descoberto. */
export function syncPairBegin(peer: string, address?: string): Promise<PairStarted> {
	return invoke<PairStarted>('sync_pair_begin', {
		db: activeDbName(),
		peer,
		address: address ?? null
	});
}

export function syncPairConfirm(peer: string, accept: boolean): Promise<void> {
	return invoke('sync_pair_confirm', { peer, accept });
}

export function syncUnpair(peer: string): Promise<SyncStatus> {
	return invoke<SyncStatus>('sync_unpair', { db: activeDbName(), peer });
}

export function onSyncApplied(handler: (payload: SyncApplied) => void): Promise<UnlistenFn> {
	return listen<SyncApplied>('atlas://sync-applied', (event) => handler(event.payload));
}

export function onPairRequest(handler: (payload: PairRequest) => void): Promise<UnlistenFn> {
	return listen<PairRequest>('atlas://sync-pair-request', (event) => handler(event.payload));
}

export function onPaired(handler: (payload: Paired) => void): Promise<UnlistenFn> {
	return listen<Paired>('atlas://sync-paired', (event) => handler(event.payload));
}

/** Id curto para caber na lista (`2fed9afd…`). */
export function shortId(id: string): string {
	return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

/** Texto de "sincronizado há X" (i18n). `0` = nunca. */
export function lastSyncLabel(at: number, now = Date.now()): string {
	if (!at) return m.sync_never();
	const minutes = Math.floor((now - at) / 60_000);
	if (minutes < 1) return m.sync_just_now();
	if (minutes < 60) return m.sync_minutes_ago({ minutes });
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return m.sync_hours_ago({ hours });
	return m.sync_days_ago({ days: Math.floor(hours / 24) });
}
