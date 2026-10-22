#!/usr/bin/env node
/**
 * Gera o override de configuração usado nos builds de teste do iOS.
 *
 * O identificador de produção (`com.reinaldoassis.atlas`) fica no
 * `src-tauri/tauri.conf.json`; a conta pessoal do Xcode usa outro App ID, então
 * os comandos `npm run ios:dev` / `npm run ios:build` passam este arquivo via
 * `--config` e o Tauri sincroniza o `PRODUCT_BUNDLE_IDENTIFIER` do projeto
 * Xcode sozinho.
 *
 * Uso:
 *   node tools/ios-test-config.mjs                 # padrão de teste
 *   ATLAS_IOS_BUNDLE_ID=com.foo.atlas npm run ios:dev
 *   node tools/ios-test-config.mjs com.foo.atlas
 *
 * O arquivo gerado é local (`.gitignore`) e o de produção nunca é alterado.
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_TEST_ID = 'com.randroi75.atlas';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv[2]?.trim();
const env = process.env.ATLAS_IOS_BUNDLE_ID?.trim();
const identifier = arg || env || DEFAULT_TEST_ID;

if (!/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(identifier) || !identifier.includes('.')) {
	console.error(`Identificador inválido: "${identifier}". Use algo como com.exemplo.atlas.`);
	process.exit(1);
}

const file = resolve(root, 'src-tauri/tauri.ios.test.local.json');
const config = {
	$schema: '../node_modules/@tauri-apps/cli/config.schema.json',
	identifier
};

writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
console.log(`iOS test bundle id: ${identifier}`);
console.log(`config: ${file}`);
