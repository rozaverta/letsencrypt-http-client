module.exports = {
	certificates: {
		'key1': ["example.com"],
	},
	basePath: __dirname,
	username: 'gosha@rozaverta.com',
	keyBits: 2048,
	maxAttempts: 15,
	directoryUrl: process.env.NODE_ENV === 'production'
		? 'https://acme-v02.api.letsencrypt.org'
		: 'https://acme-staging-v02.api.letsencrypt.org',
};