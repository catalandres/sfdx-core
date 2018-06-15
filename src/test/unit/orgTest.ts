/*
 * Copyright (c) 2018, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { constants as fsConstants } from 'fs';
import { AuthInfo, AuthFields } from '../../lib/authInfo';
import { Connection } from '../../lib/connection';
import { AnyJson } from '../../lib/types';
import { Org, OrgFields } from '../../lib/org';
import { OAuth2 } from 'jsforce';
import { expect, assert } from 'chai';
import { testSetup } from '../testSetup';
import { ConfigFile } from '../../lib/config/configFile';
import { Crypto } from '../../lib/crypto';
import { SfdxConfig } from '../../lib/config/sfdxConfig';
import { ConfigContents, ConfigValue } from '../../lib/config/configStore';
import { tmpdir as osTmpdir } from 'os';
import { join as pathJoin } from 'path';
import { Global } from '../../lib/global';
import { OrgUsersConfig } from '../../lib/config/orgUsersConfig';
import { SfdxConfigAggregator } from '../../lib/config/sfdxConfigAggregator';
import { Aliases } from '../../lib/config/aliases';
import { set as _set, get as _get, isEqual as _isEqual } from 'lodash';
import * as Transport from 'jsforce/lib/transport';
import * as fs from '../../lib/util/fs';
import * as json from '../../lib/util/json';

const $$ = testSetup();

// Setup the test environment.

class MockTestOrgData {
    public testId: string;
    public alias: string;
    public username: string;
    public devHubUsername: string;
    public orgId: string;
    public loginUrl: string;
    public instanceUrl: string;
    public clientId: string;
    public clientSecret: string;
    public authcode: string;
    public accessToken: string;
    public refreshToken: string;

    constructor() {
        this.testId = $$.uniqid();
        this.orgId = `${this.testId}`;
        this.username = `admin_${this.testId}@gb.org`;
        this.loginUrl = `http://login.${this.testId}.salesforce.com`;
        this.instanceUrl = `http://instance.${this.testId}.salesforce.com`;
        this.clientId = `${this.testId}/client_id`;
        this.clientSecret = `${this.testId}/client_secret`;
        this.authcode = `${this.testId}/authcode`;
        this.accessToken = `${this.testId}/accessToken`;
        this.refreshToken =  '${this.testId}/refreshToken';
    }

    public createDevHubUsername(username: string): void {
        this.devHubUsername = username;
    }

    public makeDevHub(): void {
        _set(this, 'isDevHub', true);
    }

    public createUser(user: string): MockTestOrgData {
        const userMock = new MockTestOrgData();
        userMock.username = user;
        userMock.alias = this.alias;
        userMock.devHubUsername = this.devHubUsername;
        userMock.orgId = this.orgId;
        userMock.loginUrl = this.loginUrl;
        userMock.instanceUrl = this.instanceUrl;
        userMock.clientId = this.clientId;
        userMock.clientSecret = this.clientSecret;
        return userMock;
    }

    public async getConfig(): Promise<ConfigContents> {
        const crypto = await Crypto.create();
        const config = new Map<string, ConfigValue>();
        config.set('orgId', this.orgId);
        config.set('accessToken', crypto.encrypt(this.accessToken));
        config.set('refreshToken', crypto.encrypt(this.refreshToken));
        config.set('instanceUrl', this.instanceUrl);
        config.set('loginUrl', this.loginUrl);
        config.set('username', this.username);
        config.set('createdOrgInstance', 'CS1');
        config.set('created', '1519163543003');
        // config.set('devHubUsername', 'tn@su-blitz.org');

        if (this.devHubUsername) {
            config.set('devHubUsername', this.devHubUsername);
        }

        const isDevHub = _get(this, 'isDevHub');
        if (isDevHub) {
            config.set('isDevHub', isDevHub);
        }

        return config;
    }
}

describe('Org Tests', () => {

    let testData: MockTestOrgData;

    beforeEach(async () => {
        testData = new MockTestOrgData();
        $$.configStubs['AuthInfoConfig'] = { contents: await testData.getConfig() };
        $$.SANDBOX.stub(Connection.prototype, 'useLatestApiVersion').returns(Promise.resolve());
    });

    describe('fields', () => {
        it('getField should get authinfo fields', async () => {
            const org: Org = await Org.create(testData.username);
            expect(org.getField(OrgFields.ORG_ID)).to.eq(testData.orgId);
        });

        it('getField should get org properties', async () => {
            const org: Org = await Org.create(testData.username);
            expect(org.getField(OrgFields.STATUS)).to.eq('UNKNOWN');
        });

        it('getFields should get a bunch of fields', async () => {
            const org: Org = await Org.create(testData.username);
            expect(org.getFields([OrgFields.ORG_ID, OrgFields.STATUS])).to.deep.eq({ orgId: testData.orgId, status: 'UNKNOWN' });
        });
    });

    describe('org:create', () => {
        it('should create an org from a username', async () => {
            const org: Org = await Org.create(testData.username);
            expect(org.getUsername()).to.eq(testData.username);
        });

        it('should create an org from an alias', async () => {
            const ALIAS: string = 'foo';
            await Aliases.parseAndUpdate([`${ALIAS}=${testData.username}`]);
            const org: Org = await Org.create(ALIAS);
            expect(org.getUsername()).to.eq(testData.username);
        });

        it('should create an org from the default username', async () => {

            const config: SfdxConfig = await SfdxConfig.create<SfdxConfig>(SfdxConfig.getDefaultOptions(true));
            await config.set(SfdxConfig.DEFAULT_USERNAME, testData.username);
            await config.write();

            const sfdxConfigAggregator: SfdxConfigAggregator = await SfdxConfigAggregator.create();

            const org: Org = await Org.create(undefined, sfdxConfigAggregator);
            expect(org.getUsername()).to.eq(testData.username);
        });

        it('should create a default devhub org', async () => {
            const config: SfdxConfig = await SfdxConfig.create<SfdxConfig>(SfdxConfig.getDefaultOptions(true));
            await config.set(SfdxConfig.DEFAULT_DEV_HUB_USERNAME, testData.username);
            await config.write();

            const sfdxConfigAggregator: SfdxConfigAggregator = await SfdxConfigAggregator.create();

            const org: Org = await Org.create(undefined, sfdxConfigAggregator, true);
            expect(org.getUsername()).to.eq(testData.username);
        });

        it('should expose getUsername', async () => {
            const org: Org = await Org.create(testData.username);
            expect(org.getUsername()).to.eq(testData.username);
        });

        it('should expose getOrgId', async () => {
            const org: Org = await Org.create(testData.username);
            expect(org.getOrgId()).to.eq(testData.orgId);
        });

    });

    describe('retrieveMaxApiVersion', () => {
        it('no username', async () => {
            $$.SANDBOXES.CONNECTION.restore();
            $$.SANDBOXES.CONNECTION.stub(Connection.prototype, 'request').callsFake(() =>
                Promise.resolve([{version: '89.0'}, {version: '90.0'}, {version: '88.0'}]));
            const org: Org = await Org.create(await Connection.create(await AuthInfo.create(testData.username)));
            const apiVersion = await org.retrieveMaxApiVersion();
            expect(apiVersion).to.equal('90.0');
        });
    });

    describe('cleanLocalOrgData', () => {
        describe('mock remove', () => {
            let removeStub;
            beforeEach(() => {
                removeStub = $$.SANDBOX.stub(fs, 'remove').callsFake((path) => {
                    return Promise.resolve();
                });
            });

            it('no org data path', async () => {
                const org: Org = await Org.create(
                    await Connection.create(await AuthInfo.create(testData.username)));

                expect(removeStub.callCount).to.be.equal(0);
                await org.cleanLocalOrgData();
                expect(removeStub.callCount).to.be.equal(1);
            });
        });

        it('InvalidProjectWorkspace', async () => {
            $$.SANDBOXES.CONFIG.restore();
            const orgSpy = $$.SANDBOX.spy(Org.prototype, 'cleanLocalOrgData');
            let invalidProjectWorkspace = false;
            $$.SANDBOX.stub(ConfigFile, 'resolveRootFolder').callsFake(() => {
                if (orgSpy.callCount > 0) {
                    invalidProjectWorkspace = true;
                    const error = new Error();
                    error.name = 'InvalidProjectWorkspace';
                    throw error;
                }
                return $$.rootPathRetriever(false);
            });
            $$.SANDBOX.stub(json, 'readJsonObject').callsFake(() => Promise.resolve({}));
            const orgDataPath = 'foo';
            const org: Org = await Org.create(
                await Connection.create(await AuthInfo.create(testData.username)));
            await org.cleanLocalOrgData(orgDataPath);
            expect(invalidProjectWorkspace).to.be.equal(true);
        });

        it('Random Error', async () => {
            $$.SANDBOXES.CONFIG.restore();
            const orgSpy = $$.SANDBOX.spy(Org.prototype, 'cleanLocalOrgData');
            $$.SANDBOX.stub(SfdxConfig, 'resolveRootFolder').callsFake(() => {
                if (orgSpy.callCount > 0) {
                    const err = new Error();
                    err.name = 'gozer';
                    throw err;
                }
                return osTmpdir();
            });
            $$.SANDBOX.stub(json, 'readJsonObject').callsFake(() => Promise.resolve({}));
            const orgDataPath = 'foo';
            const org: Org = await Org.create(
                await Connection.create(await AuthInfo.create(testData.username)));
            try {
                await org.cleanLocalOrgData(orgDataPath);
                assert.fail('This should have failed');
            } catch (e) {
                expect(e).to.have.property('name', 'gozer');
            }
        });
    });

    describe('remove', () => {
        const configFilereadJsonMock = async function() {
            if (this.path.includes(`${testData.username}.json`)) {
                return Promise.resolve(await testData.getConfig());
            }

            return Promise.resolve({});
        };

        beforeEach(() => {
            $$.configStubs['AuthInfoConfig'] = { retrieveContents: configFilereadJsonMock };
        });

        it('should remove all assets associated with the org', async () => {

            const org: Org = await Org.create(
                await Connection.create(await AuthInfo.create(testData.username)));

            const deletedPaths = [];
            $$.SANDBOX.stub(ConfigFile.prototype, 'unlink').callsFake(function() {
                deletedPaths.push(this.path);
                return Promise.resolve({});
            });

            $$.SANDBOX.stub(fs, 'remove').callsFake(() => {
                return Promise.resolve({});
            });

            await org.remove();

            expect(deletedPaths).includes(pathJoin(await $$.globalPathRetriever($$.id), Global.STATE_FOLDER,
                `${testData.orgId}.json`));
        });

        it('should not fail when no scratch org has been written', async () => {
            const org: Org = await Org.create(
                await Connection.create(await AuthInfo.create(testData.username)));

            const error: Error = new Error();
            error['code'] = 'ENOENT';

            $$.SANDBOX.stub(ConfigFile.prototype, 'unlink').callsFake(async function() {
                throw error;
            });

            $$.SANDBOX.stub(fs, 'remove').callsFake(async () => {
                return Promise.reject(error);
            });

            try {
                await org.remove();
            } catch (e) {
                assert.fail('Removes should throw and error when removing an orgConfig');
            }
        });

        it('should remove config setting', async () => {
            const sfdxConfigAggregator: SfdxConfigAggregator = await SfdxConfigAggregator.create();
            const org: Org = await Org.create(
                await Connection.create(await AuthInfo.create(testData.username)), sfdxConfigAggregator);

            const config: SfdxConfig = await SfdxConfig.create<SfdxConfig>(SfdxConfig.getDefaultOptions(true));
            await config.set(SfdxConfig.DEFAULT_USERNAME, testData.username);
            await config.write();

            await sfdxConfigAggregator.reload();
            expect(sfdxConfigAggregator.getInfo(SfdxConfig.DEFAULT_USERNAME)).has.property('value', testData.username);

            await org.remove();
            await sfdxConfigAggregator.reload();

            const defaultusername = sfdxConfigAggregator.getInfo(SfdxConfig.DEFAULT_USERNAME);
            const info = sfdxConfigAggregator.getInfo(SfdxConfig.DEFAULT_USERNAME);
            expect(defaultusername.value).eq(undefined);
            expect(info.value).eq(undefined);
        });

        it('should remove the alias', async () => {
            const org: Org = await Org.create(
                await Connection.create(await AuthInfo.create(testData.username)));

            await Aliases.parseAndUpdate([`foo=${testData.username}`]);
            let alias = await Aliases.fetch('foo');
            expect(alias).eq(testData.username);

            await org.remove();

            alias = await Aliases.fetch('foo');
            expect(alias).eq(undefined);
        });
    });

    describe('with multiple scratch org users', () => {

        let orgs: Org[];
        beforeEach(async () => {
            orgs = [];

            const orgIdUser: string = 'p.venkman@gb.org';
            const addedUser: string = 'winston@gb.org';
            const accessTokenUser: string = 'ltully@gb.org';

            const users = [
                new MockTestOrgData().createUser(orgIdUser),
                new MockTestOrgData().createUser(addedUser),
                new MockTestOrgData().createUser(accessTokenUser)
            ];

            $$.SANDBOXES.CONFIG.restore();
            $$.SANDBOX.stub(ConfigFile, 'resolveRootFolder').callsFake((isGlobal) => $$.rootPathRetriever(isGlobal, $$.id));

            let userAuthResponse = null;
            $$.SANDBOX.stub(OAuth2.prototype, '_postParams').callsFake(() => Promise.resolve(userAuthResponse));

            let responseBody = null;
            $$.SANDBOX.stub(Transport.prototype, 'httpRequest').callsFake(() => {
                return Promise.resolve(responseBody);
            });

            for (const user of users) {
                userAuthResponse = {
                    access_token: user.accessToken,
                    instance_url: user.instanceUrl,
                    id: user.testId,
                    refresh_token: user.refreshToken
                };

                responseBody = { body: JSON.stringify({ Username: user.username, OrgId: user.orgId }) };

                const userAuth = await AuthInfo.create(user.username, {
                    clientId: user.clientId,
                    clientSecret: user.clientSecret,
                    loginUrl: user.loginUrl
                });

                await userAuth.save( {orgId: user.orgId});

                const sfdxConfigAggregator: SfdxConfigAggregator = await SfdxConfigAggregator.create();

                const org: Org = await Org.create(
                    await Connection.create(await AuthInfo.create(user.username)), sfdxConfigAggregator);

                orgs.push(org);
            }

            await orgs[0].addUsername(orgs[1].getAuthInfo());
        });

        it('should validate expected files', async () => {
            const user0Config: OrgUsersConfig = await orgs[0].retrieveOrgUsersConfig();
            const user1Config: OrgUsersConfig = await orgs[1].retrieveOrgUsersConfig();

            expect(await user0Config.access(fsConstants.R_OK)).to.be.true;
            expect(await user1Config.access(fsConstants.R_OK)).to.be.false;
        });

        it('should remove aliases and config settings', async () => {
            const config: SfdxConfig = await SfdxConfig.create<SfdxConfig>(SfdxConfig.getDefaultOptions(true));

            const org0Username = orgs[0].getUsername();
            await config.set(SfdxConfig.DEFAULT_USERNAME, org0Username);
            await config.write();

            const sfdxConfigAggregator = await orgs[0].getConfigAggregator().reload();
            const info = sfdxConfigAggregator.getInfo(SfdxConfig.DEFAULT_USERNAME);
            expect(info).has.property('value', org0Username);

            const org1Username = orgs[1].getUsername();
            await Aliases.parseAndUpdate([`foo=${org1Username}`]);
            let alias = await Aliases.fetch('foo');
            expect(alias).eq(org1Username);

            await orgs[0].remove();

            await sfdxConfigAggregator.reload();
            expect(sfdxConfigAggregator.getInfo(SfdxConfig.DEFAULT_USERNAME)).has.property('value', undefined);

            alias = await Aliases.fetch('foo');
            expect(alias).eq(undefined);
        });

        it('should not try to delete auth files when deleting an org via access token', async () => {
            await orgs[2].remove();

            const user0Config: OrgUsersConfig = await orgs[0].retrieveOrgUsersConfig();
            const user1Config: OrgUsersConfig = await orgs[1].retrieveOrgUsersConfig();

            expect(await user0Config.access(fsConstants.R_OK)).to.be.true;
            expect(await user1Config.access(fsConstants.R_OK)).to.be.false;

        });
    });

    describe('checkScratchOrg', () => {
        let returnResult;
        let org: Org;
        let connection: Connection;
        beforeEach(async () => {
            $$.SANDBOX.stub(Connection.prototype, 'query').callsFake(async () => {
                if (returnResult === 'throw') {
                    const error = new Error();
                    error.name = 'INVALID_TYPE';
                    throw error;
                }
                return returnResult;
            });

            const fakeDevHub = 'foo@devhub.com';

            const sfdxConfigAggregator: SfdxConfigAggregator = await SfdxConfigAggregator.create();
            connection = await Connection.create(await AuthInfo.create(testData.username));
            org = await Org.create(connection, sfdxConfigAggregator);

            const config: SfdxConfig = await SfdxConfig.create<SfdxConfig>(SfdxConfig.getDefaultOptions(true));
            await config.set(SfdxConfig.DEFAULT_DEV_HUB_USERNAME, fakeDevHub);
            await config.write();

            await org.getConfigAggregator().reload();
        });

        it('validate is a scratch org', async () => {
            returnResult = { records: [ {} ] };
            const fields: Partial<AuthFields> = await org.checkScratchOrg();
            expect(_isEqual(fields, connection.getAuthInfo().getFields())).to.be.true;
        });

        it('validate is not scratch org', async () => {
            returnResult = { records: [] };
            try {
                await org.checkScratchOrg();
                assert.fail('This test is expected to fail.');
            } catch (err) {
                expect(err).to.have.property('name', 'NoResults');
            }
        });

        it('validate is not scratch org', async () => {
            returnResult = 'throw';
            try {
                await org.checkScratchOrg();
                assert.fail('This test is expected to fail.');
            } catch (err) {
                expect(err).to.have.property('name', 'NotADevHub');
            }
        });
    });

    describe('getDevHubOrg', () => {

        const devHubUser = 'ray@gb.org';
        beforeEach(() => {
            const retrieve = async function() {
                if (this.path.includes(devHubUser)) {
                    const mockDevHubData: MockTestOrgData = new MockTestOrgData();
                    mockDevHubData.username = devHubUser;
                    return Promise.resolve(mockDevHubData.getConfig());
                }
                return Promise.resolve(await testData.getConfig());
            };
            $$.configStubs['AuthInfoConfig'] = { retrieveContents: retrieve};
        });

        it('steel thread', async () => {
            testData.createDevHubUsername(devHubUser);
            const org: Org = await Org.create( await Connection.create(await AuthInfo.create(testData.username)));

            const devHub: Org = await org.getDevHubOrg();
            expect(devHub.getUsername()).eq(devHubUser);
        });

        it('org is devhub', async () => {
            testData.makeDevHub();
            const org: Org = await Org.create( await Connection.create(await AuthInfo.create(testData.username)));

            const devHub: Org = await org.getDevHubOrg();
            expect(devHub.getUsername()).eq(testData.username);
        });
    });

    describe('refresh auth', () => {
        let url;
        beforeEach(() => {
            $$.fakeConnectionRequest = (requestInfo: AnyJson): Promise<AnyJson> => {
                    url = requestInfo['url'];
                    return Promise.resolve({});
                };
        });
        it('should request an refresh token', async () => {
            const org: Org = await Org.create( await Connection.create(await AuthInfo.create(testData.username)));
            await org.refreshAuth();
            // Todo add the apiversion to the test string
            expect(url).to.include(`${testData.instanceUrl}/services/data/v`);
        });
    });

    describe('readUserAuthFiles', () => {
        let orgs: Org[];

        let mock0: MockTestOrgData;
        let mock1: MockTestOrgData;
        let mock2: MockTestOrgData;

        beforeEach(async () => {
            orgs = [];

            mock0 = new MockTestOrgData();
            mock1 = new MockTestOrgData();
            mock2 = new MockTestOrgData();

            const retrieve = async function() {
                const path = this.path;

                if (path && path.includes(mock0.username)) {
                    return mock0.getConfig();
                } else if (path && path.includes(mock1.username)) {
                    return mock1.getConfig();
                } else if (path && path.includes(mock2.username)) {
                    return mock2.getConfig();
                } else if (path && path.includes(mock0.orgId)) {
                    return {
                        usernames: [
                            orgs[0].getUsername(),
                            orgs[1].getUsername(),
                            orgs[2].getUsername()
                        ]
                    };
                } else {
                    throw new Error(`Unhandled Path: ${path}`);
                }
            };
            $$.configStubs['AuthInfoConfig'] = { retrieveContents: retrieve};

            orgs[0] = await Org.create(
                await Connection.create(await AuthInfo.create(mock0.username)));
            orgs[1] = await Org.create(
                await Connection.create(await AuthInfo.create(mock1.username)));
            orgs[2] = await Org.create(
                await Connection.create(await AuthInfo.create(mock2.username)));
        });

        it('should read all auth files from an org file', async () => {
            await orgs[0].addUsername(orgs[1].getConnection().getAuthInfo());
            await orgs[0].addUsername(orgs[2].getConnection().getAuthInfo());

            const orgUsers: AuthInfo[] = await orgs[0].readUserAuthFiles();
            let expectedUsers = [mock0.username, mock1.username, mock2.username];
            for (const info of orgUsers) {
                expectedUsers = expectedUsers.filter((user) => info.getFields().username !== user);
            }
            expect(expectedUsers.length).to.eq(0);
        });

        it('should read just the scratch org admin auth file when no org file', async () => {
            const orgUsers: AuthInfo[] = await orgs[0].readUserAuthFiles();
            let expectedUsers = [mock0.username];
            for (const info of orgUsers) {
                expectedUsers = expectedUsers.filter((user) => info.getFields().username !== user);
            }
            expect(expectedUsers.length).to.eq(0);
        });

        describe('removeUsername', () => {
            it('should remove all usernames', async () => {

                await orgs[0].addUsername(orgs[1].getConnection().getAuthInfo());
                await orgs[0].addUsername(orgs[2].getConnection().getAuthInfo());

                let usersPresent: string[] = null;
                await orgs[0].removeUsername(orgs[1].getConnection().getAuthInfo());
                usersPresent = $$.configStubs['OrgUsersConfig'].contents['usernames'];
                expect(usersPresent.length).to.be.eq(2);
                expect(usersPresent).to.not.include(mock1.username);

                await orgs[0].removeUsername(orgs[2].getConnection().getAuthInfo());
                usersPresent = $$.configStubs['OrgUsersConfig'].contents['usernames'];
                expect(usersPresent.length).to.be.eq(1);
                expect(usersPresent).to.not.include(mock2.username);
            });
        });
    });
});
