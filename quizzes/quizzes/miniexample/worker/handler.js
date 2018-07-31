/*******
 * To make ready for template:
 *	- update tables record in constructor to have miniexample
 *	- put db urls back to process environment variables
 *	- uncomment sending responses in index.js (sendToQueue)
 ************/
const crypto = require('crypto');

module.exports = class Handler {
	constructor() {
		const MAIN_DB_URL = 
			process.env.DATABASE_URL ||
			'postgres://pushkin:Ithn2016!@pushkin-data-db.co4mo5lsfmqs.us-east-2.rds.amazonaws.com/pushkin_data_db';

		//const TRANS_DB_URL = 'postgres://pushkin:jacob_password@pushkin-transaction-db.co4mo5lsfmqs.us-east-2.rds.amazonaws.com/pushkin_transaction_db';//process.env.TRANSACTION_DATABASE_URL;
		this.tables = {
			users: 'miniexample_users',
			stim: 'miniexample_stimuli',
			stimResp: 'miniexample_stimulusResponses',
			stimGroups: 'miniexample_stimulusGroups',
			stimGroupStim: 'miniexample_stimulusGroupStimuli',
			TUQ: 'miniexample_TUQ',
			TUQSR: 'miniexample_TUQSR',
		};

		this.pg_main = require('knex')({
			client: 'pg',
			connection: MAIN_DB_URL,
		});
		/*
		this.pg_trans = require('knex')({
			client: 'pg',
			connection: TRANS_DB_URL,
		});
		*/
	}

	// returns a promise with the requested data (if any)
	// throws an error if the method doesn't exist
	handle(req) {
			// some methods send '' as the data string when none is needed
			// so check for undefined rather than truthyness
			if (!req || !req.method || req.data === undefined)
				throw new Error('invalid request. Requests must have a method and data field');

			// each method in the switch statement below should use this function to ensure
			// all its required fields are present
			const requireDataFields = fields => {
				const missing =
					(typeof req.data == 'object' ?
						fields.reduce( (acc, field) => ((field in req.data) ? acc : [...acc, field]), [])
						: fields
					);
				if (missing.length > 0)
					throw new Error(`${req.method}'s req.data must have fields ${fields}. Missing ${missing}`);
			};

		// using a mapping like this is nicer than calling something like "this[req.method]" because
		// it allows us to have other functions without exposing them all to the api
		// as well as require the pertinent fields
			switch (req.method) {

			// methods called through API controller
				case 'generateUser':
					// no data fields to require
					return this.generateUser();

				case 'startExperiment':
					requireDataFields(['user_id']);
					return this.startExperiment(req.data.user_id);

				case 'getStimuliForUser':
					requireDataFields(['user_id']);
					return this.getStimuliForUser(req.data.user_id);

				case 'insertMetaResponse':
					throw new Error('meta responses not yet implemented using database');
					requireDataFields(['user_id', 'data_string']);
					return this.insertMetaResponse(req.data.user, req.data.data_string);

				case 'insertStimulusResponse':
					requireDataFields(['user_id', 'data_string']);
					return this.insertStimulusResponse(req.data.user_id, req.data.data_string);

				case 'endExperiment':
					requireDataFields(['user_id']);
					return this.endExperiment(req.data.user_id);

					//case 'getMetaQuestionsForUser':
					//requireDataFields(['user_id']);
					//return this.getMetaQuestionsForUser(req.data.user_id);
					//break;

					//case 'generateUserWithAuth':
					//requireDataFields(['auth_id']);
					//return this.generateUserWithAuth(req.data.auth_id);
					//break;

					//case 'updateUser':
					//requireDataFields(['user_id', 'auth_id']);
					//return this.updateUser(req.data.user, req.data.auth);
					//break;

					//case 'getAllStimuli':
					//// no data fields to require
					//return this.getAllStimuli();
					//break;

					//case 'activateStimuli':
					//// no data fields to require
					//return this.activateStimuli();
					//break;

					//case 'health':
					//// no data fields to require
					//return this.health();
					//break;

			// methods used by other services (e.g. cron or task worker)
					//case 'getUserStimulusResponses':
					//requireDataFields(['user_id']);
					//return this.getUserStimulusResponses(req.data.user_id);
					//break;

					//case 'getDataForPrediction':
					//requireDataFields(['user_id']);
					//return this.getDataForPrediction(req.data.user_id);
					//break;

				default:
					throw new Error(`method ${req.method} does not exist`);
			}
	}

	/*************** METHODS CALLED BY HANDLER & HELPER FUNCTIONS (all return promises) ****************/

	// for ephemeral test-takers (a new one's made each time a quiz is taken)
	// resolves to the new user id
	generateUser() {
		return new Promise( (resolve, reject) => {
			const insertData = {
				created_at: new Date(),
				updated_at: new Date()
			};
			this.pg_main(this.tables.users).insert(insertData).returning('id')
				.then(d => resolve(d[0]))
				.catch(reject);
		});
	}

	startExperiment(user) {

		return new Promise( async (resolve, reject) => {
			if (!(await this.userExists(user))) {
				reject(`user ${user} doesn't exist, aborting`);
				return;
			}

			// check if the user already has a TUQ record
			if ((await this.pg_main(this.tables.TUQ).where('user_id', user).count('*'))[0].count > 0) {
				reject(`user ${user} already has a TUQ record, aborting`);
				return;
			}

			// good to go
			const maxStimuli = 10;
			console.log(`starting experiment for user ${user} with ${maxStimuli} max stimuli`);

			// create a stimulus group (stimGroups) (for this experiment, we'll just
			// make a new group for each quiz run rather than reusing them)
			const stimGroupId = (await this.pg_main(this.tables.stimGroups)
				.insert({ created_at: new Date() }).returning('id'))[0];

			console.log(`assigned user ${user} stimulus group ${stimGroupId}`);
			
			const selectedStims = await this.pg_main(this.tables.stim)
				.select('id').orderByRaw('random()').limit(maxStimuli);

			console.log(`selected ${selectedStims.length} stimuli for group ${stimGroupId}`);

			// add stimuli to the group (stimGroupStim)
			let position = 0;
			await this.pg_main(this.tables.stimGroupStim).insert(
				selectedStims.map(stim => ({
						group: stimGroupId,
						stimulus: stim.id,
						position: position++
				}))
			);

			console.log(`added ${selectedStims.length} stimuli to group ${stimGroupId}`);

			// initialize This User Quiz (TUQ)
			await this.pg_main(this.tables.TUQ).insert({
				user_id: user,
				stim_group: stimGroupId,
				started_at: new Date(),
				cur_position: 0
			});

			console.log(`created new TUQ record for user ${user}`);
			console.log(`done starting experiment for user ${user}`);

			resolve();
		});
	}

	getStimuliForUser(user) {
		return new Promise( async (resolve, reject) => {
			const stimGroupId = (await this.pg_main(this.tables.TUQ)
				.where('user_id', user).select('stim_group'))[0];

			const stims = await this.pg_main(this.tables.stim).join(
				this.tables.stimGroupStim,
				`${this.tables.stim}.id`,
				`${this.tables.stimGroupStim}.stimulus`
			).where(`${this.tables.stimGroupStim}.group`, stimGroupId)
				.select(`${this.tables.stim}.stimulus`);

			resolve(stims);
		});
	}

	insertMetaResponse(user, type, response) {

	}

	insertStimulusResponse(user, response) {
		console.log(`inserting response for user ${user}: \n\n\t${response}\n`);


		// DO CHECKS (not past end, etc.)

		return this.pg_main(this.tables.TUQ).where('user_id', user).select(
			'stim_group', 'cur_position').then(TUQdata => {
				const t = TUQdata[0];
				return this.pg_main(this.tables.stimGroupStim)
					.where({
						group: t.stim_group,
						position: t.cur_position
					}).select('stimulus')
			}).then(stimulus => {
				return this.pg_main(this.tables.TUQSR).insert({
					user_id: user,
					stimulus: stimulus[0].stimulus,
					response: JSON.stringify(response),
					answered_at: new Date()
				});
			}).then(_ => {
				return this.pg_main(this.tables.TUQ).where('user_id', user).increment('cur_position');
			}).then(_ => ''); // returning useless info from last promise is confusing
	}

	endExperiment(user) {
		return this.userExists(user).then(exists => {
			if (!exists) {
				throw new Error(`endExperiment: user ${user} doesn't exist, aborting`);
				return;
			}
		}).then(async _ => {
			// make sure the user has a TUQ record
			if ((await this.pg_main(this.tables.TUQ).where('user_id', user).count('*'))[0].count == 0) {
				throw new Error(`endExperiment: user ${user} doesn't have a TUQ record, aborting`);
				return;
			}
		}).then(_ => { // good to go
			// get TUQSRs
			return this.pg_main(this.tables.TUQSR).where('user_id', user).select('*');
		}).then(responses => {
			// put TUQSRs in stimResp
			return this.pg_main(this.tables.stimResp).insert(
				responses.map(r => ({
					user_id: user,
					stimulus: r.stimulus,
					response: JSON.stringify(r.response),
					created_at: r.answered_at,
					updated_at: r.modified_at
				}))
			)
		}).then(_ => {
			// delete TUQSRs
			return this.pg_main(this.tables.TUQSR).where('user_id', user).del();
		}).then(_ => {
			// delete TUQ record
			return this.pg_main(this.tables.TUQ).where('user_id', user).del();
		}).then(_ => ''); // returning useless info from last promise is confusing
	}

	/*************** helpers **************/
	uniqueNumber() {
		// first 3 bytes -> max 4 digit number, which is what's used in the database
		return parseInt(randomBytes(13).toString('hex').substring(0, 3), 16);
	}

	async userExists(user) {
		const count =
			(await this.pg_main(this.tables.users).count('id').where('id', user));
		return count[0].count > 0;
	}


	//getMetaQuestionsForUser(user) {
	//return this.pg_main(this.tables.metaQuestions).select('question_json');
	//}

	

	// resolves to true or false if the user exists respectively
	//userExists(user) {
	//return new Promise( (resolve, reject) => {
	//// better to resolve false than reject the promise because then actual
	//// errors with connection, etc. may be interpreted as the user not existing
	//this.pg_main(this.tables.users).count('*').where('id', user)
	//.then(res => resolve(res ? true : false))
	//.catch(reject);
	//});
	//}


	// same as generateUser, but associates the new user id with the given auth id
	//async generateUserWithAuth(auth) {
	//return new Promise( (resolve, reject) => {
	//const insertData = {
	//auth0_id: auth,
	//created_at: new Date(),
	//updated_at: new Date()
	//};
	//this.pg_main(this.tables.users).insert(insertData).returning('id')
	//.then(resolve)
	//.catch(reject);
	//});
	//}

	// associate a user in the users table with an auth0 id
	//updateUser(user, auth) {
	//return new Promise( (resolve, reject) => {
	//this.pg_main(this.tables.users)
	//.where('id', user)
	//.update('auth0_id', auth)
	//.then(resolve)
	//.catch(reject);
	//});
	//}

	//getAllStimuli() {
	//return new Promise( (resolve, reject) => {
	//this.pg_main.select().table(this.tables.stim)
	//.then(resolve)
	//.catch(reject);
	//});
	//}

	//getNextStimulus(user) {
	//return new Promise( (resolve, reject) => {
	//reject('getNextStimulus in handler not yet implemented. What exactly should it do?');
	//});
	//}
	//
	//
	//activateStimuli() {
	//return new Promise( (resolve, reject) => {
	//reject('activateStimuli in handler not yet implemented. Table structure not in place.');
	//});
	//}
	//
	//
	//health() {
	//return new Promise( (resolve, reject) => {
	//resolve({ message: 'healthy' });
	//});
	//}
	//
	//
	//getUserStimulusResponses(user) {
	//return new Promise( (resolve, reject) => {
	//this.pg_main(this.tables.stimResp)
	//.where('id', user)
	//.select('*')
	//.then(resolve)
	//.catch(reject);
	//});
	//}


	//getDataForPrediction(user) {
	//return new Promise( (resolve, reject) => {
	//reject('getDataForPrediction: should this do the same as getUserStimulusResponses?');
	//});
	//}
}







