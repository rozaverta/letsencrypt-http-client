#!/usr/bin/env node

const fs = require('fs');
const {join} = require('path');

const args = {};
const single = ['cert', 'serv', 'help'];
const argsNull = Symbol();
args[argsNull] = true;

for(let i = 2; i < process.argv.length; i++) {
	let arg = process.argv[i];
	if(arg.substr(0, 2) === '--') {
		const match = arg.match(/^--(?<name>[a-zA-Z0-9\-]+)=(?<value>.+?)$/);
		if(match) {
			const {name, value} = match.groups;
			args[name] = value;
		}
		else {
			arg = arg.substr(2);
			if(!args.hasOwnProperty(arg)) {
				args[arg] = true;
			}
		}
	}
}

if(args.dotenv) {
	require('dotenv').config(
		typeof args.dotenv === "string" ? {path: args.dotenv} : undefined
	);
}

const debug = require('debug')('acme');

const debExit = (message) => {
	console.warn(message);
	process.exit(1);
};

const isSingle = (name) => {
	if(!args[name]) {
		return false;
	}
	for(let i = 0, n; i < single.length; i++) {
		n = single[i];
		if(n !== name && args[n]) {
			if(name === argsNull) {
				return false;
			}
			debExit(`You cannot run the --${name} argument with the --${n} argument`)
		}
	}
	return true;
};

const help = (nullable) => {
	const log = nullable ? console.error : console.log;
	log('Usage: acme --config=<path>');
	log('');
	log('  Running ACME server (well-known) on port 80 or verifying certificates.');
	log('');
	log('Options:');
	log('');
	log('  --config     Config path, required');
	log('  --dotenv     Use ENV file, blank value for default path or env file');
	log('  --serv       Start ACME server');
	log('  --cert       Start checking certificates');
	log('  --help       This menu');
	process.exit(nullable ? 1 : 0);
};

if(isSingle('help')) {
	help(false);
}

if(typeof args.config !== "string") {
	const conf = process.env.ACME_CONFIG;
	if(conf) {
		args.config = conf;
	}
	else if(isSingle(argsNull)) {
		help(true);
	}
	else {
		debExit('--config argument not defined');
	}
}

const configPath = join(process.cwd(), args.config);
if(!fs.existsSync(configPath)) {
	debExit(`The ${args.config} config file not found`);
}

const config = require(configPath);

// start acme server
if(isSingle('serv')) {
	require('../src/acmeServer')(config).catch(err => {
		console.log('ACME-server error', err);
	})
}

// check cert
else if(isSingle('cert')) {

	const {certificates = {}, ...conf} = config;
	const {Client, eachConfig} = require('../src');

	const load = async (client) => {
		await client.init();
		return Promise.all(eachConfig(certificates, async (key, domains) => {
			let updated = false;
			try {
				const expired = client.isExpired(key);
				if(expired) {
					await client.generateCertificate({key, domains});
					updated = true;
				}
				else {
					debug(`Certificate for ${key} is still valid, going back to bed.`);
				}
			}
			catch(err) {
				debug(`Updating cert for ${key}, received err ${err}`);
				return {err};
			}
			return {updated};
		})).catch(
			err => {
				debug(`Updating err ${err}`);
			}
		);
	};

	const client = new Client(conf);
	load(client).then(
		(result) => {

			const updated = result.filter(item => item.updated === true).length;
			const errors = result.filter(item => !! item.err).length;
			const ignored = result.length - updated - errors;

			updated && debug('Updating cert:', updated);
			errors && debug('Error cert:', errors);
			ignored && debug('Ignored cert:', ignored);

			client.clear();
		},
		err => {
			debug(`Updating fatal ${err}`);
			client.clear();
		}
	);
}

// unknown
else {
	help(true);
}