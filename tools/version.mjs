#!/usr/bin/env node
/**
 * Fonte única da versão do Atlas.
 *
 * Uso:
 *   node tools/version.mjs                 # imprime a versão (VERSION)
 *   node tools/version.mjs set 0.3.2       # grava VERSION + package/lock + tauri + Cargo
 *   node tools/version.mjs check           # confere se todos estão iguais
 *   node tools/version.mjs check 0.3.2     # exige também que a tag espere 0.3.2
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PATHS = {
	version: resolve(ROOT, 'VERSION'),
	package: resolve(ROOT, 'package.json'),
	tauri: resolve(ROOT, 'src-tauri/tauri.conf.json'),
	cargo: resolve(ROOT, 'src-tauri/Cargo.toml'),
	lock: resolve(ROOT, 'src-tauri/Cargo.lock'),
	packageLock: resolve(ROOT, 'package-lock.json')
};
const SEMVER = /^\d+\.\d+\.\d+$/;

function fail(message) {
	console.error(`version: ${message}`);
	process.exit(1);
}

function readVersion() {
	return readFileSync(PATHS.version, 'utf8').trim();
}

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value, indent) {
	writeFileSync(path, `${JSON.stringify(value, null, indent)}\n`);
}

function setVersion(version) {
	if (!SEMVER.test(version)) fail(`versão inválida (use X.Y.Z): ${version}`);
	writeFileSync(PATHS.version, `${version}\n`);

	const pkg = readJson(PATHS.package);
	pkg.version = version;
	writeJson(PATHS.package, pkg, '\t');

	const tauri = readJson(PATHS.tauri);
	tauri.version = version;
	writeJson(PATHS.tauri, tauri, 2);

	const cargo = readFileSync(PATHS.cargo, 'utf8').replace(
		/^version\s*=\s*"[^"]*"/m,
		`version = "${version}"`
	);
	writeFileSync(PATHS.cargo, cargo);

	const lock = readFileSync(PATHS.lock, 'utf8').replace(
		/(\[\[package\]\]\nname = "app"\nversion = )"[^"]*"/,
		`$1"${version}"`
	);
	writeFileSync(PATHS.lock, lock);

	const packageLock = readJson(PATHS.packageLock);
	packageLock.version = version;
	if (packageLock.packages?.['']) packageLock.packages[''].version = version;
	writeJson(PATHS.packageLock, packageLock, '\t');

	console.log(
		`version: ${version} (VERSION, package.json, package-lock.json, tauri.conf.json, Cargo.toml, Cargo.lock)`
	);
}

function checkVersion(expected) {
	const version = readVersion();
	const errors = [];
	if (!SEMVER.test(version)) errors.push(`VERSION inválido: ${version}`);
	if (expected && expected !== version) {
		errors.push(`tag/esperado ${expected} != VERSION ${version}`);
	}
	const pkg = readJson(PATHS.package);
	if (pkg.version !== version) {
		errors.push(`package.json ${pkg.version} != VERSION ${version}`);
	}
	const tauri = readJson(PATHS.tauri);
	if (tauri.version !== version) {
		errors.push(`tauri.conf.json ${tauri.version} != VERSION ${version}`);
	}
	const cargo = readFileSync(PATHS.cargo, 'utf8');
	const cargoVersion = /^version\s*=\s*"([^"]*)"/m.exec(cargo)?.[1];
	if (cargoVersion !== version) {
		errors.push(`Cargo.toml ${cargoVersion ?? '?'} != VERSION ${version}`);
	}
	const lock = readFileSync(PATHS.lock, 'utf8');
	const lockVersion = /\[\[package\]\]\nname = "app"\nversion = "([^"]*)"/.exec(lock)?.[1];
	if (lockVersion !== version) {
		errors.push(`Cargo.lock ${lockVersion ?? '?'} != VERSION ${version}`);
	}
	const packageLock = readJson(PATHS.packageLock);
	if (packageLock.version !== version || packageLock.packages?.['']?.version !== version) {
		errors.push(`package-lock.json ${packageLock.version} != VERSION ${version}`);
	}
	if (errors.length) {
		for (const error of errors) console.error(`version: ${error}`);
		console.error('version: rode `npm run version:set -- X.Y.Z` e commite os seis arquivos.');
		process.exit(1);
	}
	console.log(`version: ${version} ok`);
}

const [command = 'get', value] = process.argv.slice(2);
switch (command) {
	case 'get':
		console.log(readVersion());
		break;
	case 'set':
		if (!value) fail('use `set X.Y.Z`');
		setVersion(value);
		break;
	case 'check':
		checkVersion(value);
		break;
	default:
		fail(`comando desconhecido: ${command}`);
}
