# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [2.1.2](https://github.com/Wfelipe2011/territory-manager-v2/compare/v2.1.1...v2.1.2) (2026-08-12)


### Bug Fixes

* renomeia alias do pgbouncer hmg para pgbouncer-hmg ([284bd82](https://github.com/Wfelipe2011/territory-manager-v2/commit/284bd82a549dad87041710440280019b1c2dcc39))

### [2.1.1](https://github.com/Wfelipe2011/territory-manager-v2/compare/v2.1.0...v2.1.1) (2026-08-12)


### Bug Fixes

* alinha compose de acceptance com o de prod (pgbouncer + DIRECT_URL) ([e0898df](https://github.com/Wfelipe2011/territory-manager-v2/commit/e0898df24d8c9fa7e3a3f3ac3398b08519ab4771))

## [2.1.0](https://github.com/Wfelipe2011/territory-manager-v2/compare/v2.0.0...v2.1.0) (2026-08-12)


### Features

* adiciona suporte a homolog no gerador de URL realtime ([949b171](https://github.com/Wfelipe2011/territory-manager-v2/commit/949b171074b0b3d086940f6295b7323613a05af1))


### Bug Fixes

* aponta DIRECT_URL direto ao Postgres para o LISTEN/NOTIFY do SSE ([429beaf](https://github.com/Wfelipe2011/territory-manager-v2/commit/429beaf893cef5fb5f789020dfb2e244fc6047ec))

## 2.0.0 (2026-08-12)


### ⚠ BREAKING CHANGES

* **realtime:** WebSocket /socket.io endpoint removed; clients must use SSE /v1/realtime/street/:t/:b/:a

### Features

* Add 'round' and 'tenantId' properties to RequestSignature ([5b88b90](https://github.com/Wfelipe2011/territory-manager-v2/commit/5b88b9082e813e76e902b7e29a4ed20eb563c46a))
* add `theme_mode` column and route to fetch current theme ([b39cebe](https://github.com/Wfelipe2011/territory-manager-v2/commit/b39cebeb87f1bd40b09726cc40387685114e34a3))
* add city and state columns to multi_tenancy table and improve health check logic- Add `city` and `state` columns to the `multi_tenancy` table with default values.- Refactor the health check method in the AppController to utilize helper methods for retrieving database and system information.- Enhance performance by using `Promise.all` for concurrent database queries ([f429157](https://github.com/Wfelipe2011/territory-manager-v2/commit/f42915734f5e265a82072e2529124fe7521eb8e1))
* add Firebase integration and v2 territory endpoints with pagination support- Updated package.json to include Firebase and Multer dependencies.- Introduced FirebaseService for file uploads to Firebase Storage.- Added versioning support with V2 for territory endpoints.- Implemented pagination parameters in TerritoryServiceV2.- Created contracts for find-all parameters validation ([ada4ce9](https://github.com/Wfelipe2011/territory-manager-v2/commit/ada4ce9b42a7e864ad0f71c86c40d34b370c6934))
* add IsOptional validation to zipCode field in UpsertAddressDto ([1f13458](https://github.com/Wfelipe2011/territory-manager-v2/commit/1f1345848b41376751aa84f7ca3201fac72ee449))
* add system information retrieval to health check endpoint ([c457125](https://github.com/Wfelipe2011/territory-manager-v2/commit/c45712598ebb93378ef13fbd03e3c68625ed49ea))
* add territoryBlockAddressId to UpsertHouseInput and related services ([dc0df80](https://github.com/Wfelipe2011/territory-manager-v2/commit/dc0df807a075b92aa362f89eb2cbff2bf9884ad3))
* add theme colors and refactor AddressBlockService and RoundService to utilize them ([bacc2a1](https://github.com/Wfelipe2011/territory-manager-v2/commit/bacc2a1b533229741732e3fbb163d1591d133dc4))
* **address:** add address fetching functionality and API endpoint for all addresses ([0d6b278](https://github.com/Wfelipe2011/territory-manager-v2/commit/0d6b2787f164a2813688cc8f152ad6dcf4dc2f33))
* **app:** add city field to congregation query in AppController ([0682d62](https://github.com/Wfelipe2011/territory-manager-v2/commit/0682d6265fd67b2f4cb2003095a5382f63442461))
* **app:** add image upload endpoint with validation and Firebase integrationIntroduces a new POST /:id/upload endpoint allowing image uploads with size and type restrictions. Uses FileInterceptor for file handling and FirebaseUploadService for storage, mapping specific IDs to storage paths. Adds FirebaseModule for dependency injection and updates app module providers accordingly. Enhances server functionality with secure, validated image uploads ([1cbf995](https://github.com/Wfelipe2011/territory-manager-v2/commit/1cbf9955daf0ab373309ba816b7a208232c233a7))
* **auth:** add hashPassword method and endpoint to AuthController ([f1af078](https://github.com/Wfelipe2011/territory-manager-v2/commit/f1af0788b5dcdb8ce2692684afa81989fe80a9b0))
* **auth:** normalize email to lowercase in login and password recovery methods ([b4a1090](https://github.com/Wfelipe2011/territory-manager-v2/commit/b4a1090c8116d803fe6b18ecd2bd185b36fdd6d8))
* **auth:** update resetPassword method to use email instead of token for password reset and return a JWT token ([d08660d](https://github.com/Wfelipe2011/territory-manager-v2/commit/d08660dfe34af23d9ca8fd85386c1b706a5d6aa7))
* **block:** add address management and territory block association features with Prisma integration ([12bc2d7](https://github.com/Wfelipe2011/territory-manager-v2/commit/12bc2d7df1b631692afbd4e49d0645ff402ee00b))
* **block:** add deleteBlock feature to remove blocks and dependencies ([a591fbc](https://github.com/Wfelipe2011/territory-manager-v2/commit/a591fbc4d4f0dae4dfd41a9300d4445458c1cace))
* **block:** add Swagger decorators for API documentation in BlockController and UpsertBlockDto ([388c11f](https://github.com/Wfelipe2011/territory-manager-v2/commit/388c11fc35aec4243d450c469c940543775e5b98))
* **dashboard:** add dashboard module with controller and service for marked houses and territory details retrieval ([0a20cf4](https://github.com/Wfelipe2011/territory-manager-v2/commit/0a20cf418401e05c8dac06b6196d40f0b062d7a8))
* **dashboard:** enhance findMarkedHouses and territoryDetails to dynamically include all types in the SQL query results ([8241e5b](https://github.com/Wfelipe2011/territory-manager-v2/commit/8241e5be6fdbced032973bcb7a44fd84e828892b))
* **database:** add completed_date column to round model and update related queries- Add new column completed_date to the round table in migration.sql- Update schema.prisma to include completed_date in the round model- Modify dashboard.service.ts to query based on completed_date- Update Houses interface to include completed_date- Adjust house.service.ts to utilize completed_date for status updates ([2e9f99c](https://github.com/Wfelipe2011/territory-manager-v2/commit/2e9f99c6bae52b8cc9ffed4092e658fe3afa6326))
* **database:** create territory_block_address table and update related modelsAdd new migration for territory_block_address table and update house model to include territory_block_address_id. Update Prisma schema for relationships and foreign keys. Create a script to populate the new table based on existing house data. Refactor PrismaService into a dedicated module with middleware for connection management. Adjust imports throughout the application to use the new Prisma module structure ([1342ecb](https://github.com/Wfelipe2011/territory-manager-v2/commit/1342ecbb7004adee3397c6dcf34df2c0eb106c76))
* enhance house sorting logic to prioritize numeric house numbers and maintain order ([5a30468](https://github.com/Wfelipe2011/territory-manager-v2/commit/5a30468a385a5b9f182d135bd97ce74bcae6801b))
* enhance house sorting logic to prioritize numeric values in house numbers ([accdc28](https://github.com/Wfelipe2011/territory-manager-v2/commit/accdc2818e558c8870dd0d6813c7307de84085a2))
* **firebase:** add Firebase table and integrate with Prisma service for dynamic config loading and file deletion functionality ([6299e06](https://github.com/Wfelipe2011/territory-manager-v2/commit/6299e06f1caaba3f6ec2f4b3a4f926efc9a1b418))
* **gateway:** implement WebSocket gateway initialization and socket management logic- Add OnGatewayInit interface to EventsGateway class- Log initialization message when gateway is created- Modify socket handling to upsert instead of create- Change cron job to check for disconnected sockets every 30 seconds and emit events for user count updates in rooms ([7566a20](https://github.com/Wfelipe2011/territory-manager-v2/commit/7566a20b59a50ca2f459b6fca8f4ba0098da8dcb))
* **house, records:** add records module and upsert house input DTO for better data handling and validation ([5d69479](https://github.com/Wfelipe2011/territory-manager-v2/commit/5d69479a0615ce6bb4a5f747f5ae6d420ecdad9a))
* **house:** add custom hours tenancy logic to HouseService for tenant validation ([4dbee7e](https://github.com/Wfelipe2011/territory-manager-v2/commit/4dbee7e40132c9d30cd39347a23dcd80fb0d1558))
* **house:** add HouseWorkerService for ghost house management and improve error handling in AddressBlockService ([6a235cc](https://github.com/Wfelipe2011/territory-manager-v2/commit/6a235ccab94f75e1c2fbbe5a6418eb11fcbb1ca4))
* **house:** add UpdateHouseOrder feature for updating house order in the controller and service ([c9884fb](https://github.com/Wfelipe2011/territory-manager-v2/commit/c9884fb4c2d2a26e70116d0f097cd538a22ba765))
* implement getCustomHoursTenancy function and integrate it into HouseService and SignatureService for dynamic expiration time calculation ([10b482f](https://github.com/Wfelipe2011/territory-manager-v2/commit/10b482f0913f46539aa156de0c5604d8ec715a14))
* implement quarantine classification for houses and update related logic ([94785bf](https://github.com/Wfelipe2011/territory-manager-v2/commit/94785bf0e0cac4701868c74450f0fcfec41d7042))
* **logging:** add Loggable decorator for request logging and enhance RequestSignature interface with userId and userName fields ([8c99248](https://github.com/Wfelipe2011/territory-manager-v2/commit/8c99248dbec20c1c15e44231834f5bcaf201d7f3))
* **realtime:** migrate from socket.io to SSE + pg_notify for cross-instance fan-out ([1c3223e](https://github.com/Wfelipe2011/territory-manager-v2/commit/1c3223e0938fef65094deb95d3f8c64845ad68ae))
* **report:** add CreateReport DTO and current user decorator for report creation validation and user extraction ([594e909](https://github.com/Wfelipe2011/territory-manager-v2/commit/594e909d704dfe624762ea55454538595b96d2f0))
* **report:** add functionality to remove ghost houses in report approval process ([da07235](https://github.com/Wfelipe2011/territory-manager-v2/commit/da072350ccbb01d1daf3ae0dff348eedb1cbba79))
* **report:** add report management functionality with enum and database migrations ([13dd606](https://github.com/Wfelipe2011/territory-manager-v2/commit/13dd606e7d6250758b02abc3eec6d66c2d807ec8))
* **report:** update report controller to use UserToken for current user context and enforce tenantId checks ([0691bac](https://github.com/Wfelipe2011/territory-manager-v2/commit/0691bac4a09f88cca5f4314fd4a35f4a891e9d8f))
* **round:** add endpoint to retrieve round info by round number and implement corresponding service method ([f751fe6](https://github.com/Wfelipe2011/territory-manager-v2/commit/f751fe6e2b2ca39ac61e2fc08ee1103daeb35a03))
* **round:** add finish and start round endpoints with body validation and theme support ([4ef58ff](https://github.com/Wfelipe2011/territory-manager-v2/commit/4ef58ff0b87b21dce23656dd696ea34472b92396))
* **round:** add leave_letter column to round table and update related DTOs and services ([fb1b02f](https://github.com/Wfelipe2011/territory-manager-v2/commit/fb1b02fc116229e22f4caf7c2eeb13ad45934af5))
* **round:** add round_info table and update related logic in round controller and service ([a574ce6](https://github.com/Wfelipe2011/territory-manager-v2/commit/a574ce6f162381f9ed7ee04b408494ae66218217))
* **round:** add type column to round_info and update related logic- Introduce new "type" column in round_info table with default value 'Residencial'.- Update CreateRoundDto to include typeId for better handling of round types.- Modify RoundService and RoundController to accommodate new type logic.- Adjust tenant creation script for consistent naming and phone number.- Ensure all related methods utilize the new type information ([360e009](https://github.com/Wfelipe2011/territory-manager-v2/commit/360e00947786c8071e4fa229d8d43ec46443f136))
* **signature:** add round parameter to createSignatureTerritoryBlock endpoint ([fa2e578](https://github.com/Wfelipe2011/territory-manager-v2/commit/fa2e578fd057b903474b443d3e1bb2933f054cd8))
* **signature:** add round parameter to createSignatureTerritoryBlock endpoint ([42b4f2f](https://github.com/Wfelipe2011/territory-manager-v2/commit/42b4f2f4d5d6357b6f112f111eb95430236c7f79))
* **signature:** Add round parameter to signature generation ([4fd3c29](https://github.com/Wfelipe2011/territory-manager-v2/commit/4fd3c29d81a703146c253c16d0a37a1534fcda41))
* **territory:** add find-one parameters and territory edit output interfaces, and implement territory edit retrieval logic in the controller and service ([5bf66a9](https://github.com/Wfelipe2011/territory-manager-v2/commit/5bf66a925e7ba50ba838e88da07eeedeeb93df28))
* **territory:** add search and type parameters to FindAllParams for enhanced filtering functionality ([1673d88](https://github.com/Wfelipe2011/territory-manager-v2/commit/1673d887e484e9c79151322e8a7d3b8ff5a3e848))
* **territory:** add typeId property to TerritoryAllOutput and RawTerritoryAll interfaces ([0de8df1](https://github.com/Wfelipe2011/territory-manager-v2/commit/0de8df158462bfe4fb04efdf86154c4ad36bb605))
* **territory:** add updateAt property and sorting for blocks in TerritoryOneOutput class ([1db6f2b](https://github.com/Wfelipe2011/territory-manager-v2/commit/1db6f2ba0e56f32eb0bac0e1f1e52ff2751d5181))
* **territory:** implement territory creation endpoint with validationAdds a new endpoint to create a territory in the TerritoryController, utilizing the CreateTerritoryParams class for request validation. Implements OnModuleInit in FirebaseService to initialize Firebase Admin SDK and connect to the database, enhancing service reliability ([ec89c5d](https://github.com/Wfelipe2011/territory-manager-v2/commit/ec89c5d13e768663e74834dfae9c9bfacef2caf6))
* **territory:** implement upload functionality for territory data with WebSocket progress notifications and create UploadGateway for real-time updates ([7a309ea](https://github.com/Wfelipe2011/territory-manager-v2/commit/7a309ea7a8202cf30a7f13d0e759a6c9b0619adf))
* **transactions:** add PayPal transactions management and CSV upload functionality- Introduce new model for PayPal transactions in the database.- Implement TransactionsController for handling CSV uploads and balance retrieval.- Create TransactionsService for saving transactions to the database.- Add HttpModule to app module for external HTTP requests.- Include necessary dependencies in package.json ([1e77451](https://github.com/Wfelipe2011/territory-manager-v2/commit/1e77451e5d2b8f73ea001f65d4207ccd2fa32b34))
* **transactions:** add public decorator to getBalance endpoint ([4a41f9c](https://github.com/Wfelipe2011/territory-manager-v2/commit/4a41f9c00c5f629728fbbae7658f2831b0e34bce))
* **transactions:** update date format from DD/MM/YYYY to YYYY-MM-DD in transactions processing ([f65f474](https://github.com/Wfelipe2011/territory-manager-v2/commit/f65f47492e6631103d00b72daaae2ac0be3036f8))
* update leaveLetter logic to ensure correct evaluation based on house rounds ([f61e2cb](https://github.com/Wfelipe2011/territory-manager-v2/commit/f61e2cbdfa0c2863192473d45a761b2186b84a77))
* **upload-territory:** add populateTerritoryAddress method to link houses with territory addresses and log progress during upload process ([602a5f9](https://github.com/Wfelipe2011/territory-manager-v2/commit/602a5f94245fabf1b98c245a0fbc23a15b7707f6))


### Bug Fixes

* **address-block:** increase similarity threshold for address matching query ([27cccc0](https://github.com/Wfelipe2011/territory-manager-v2/commit/27cccc08c914253815336d24c4922ea9740115bf))
* aguarda exclusão das assinaturas de quadras ao deletar assinatura do território ([129de49](https://github.com/Wfelipe2011/territory-manager-v2/commit/129de49a0abb803dbe10c56dbc61bcb62ef7040f))
* **app.controller:** update signature expiration check to only count future signatures ([a7d35b3](https://github.com/Wfelipe2011/territory-manager-v2/commit/a7d35b3cf7e342c1147008ad9a05583115b0c266))
* **ci:** update checkout action token to use GH_PAT only ([5779d23](https://github.com/Wfelipe2011/territory-manager-v2/commit/5779d23cef6af5ddbc83d9fc40f05bc5c24e2eac))
* **dashboard.service:** handle errors in database queries with console logging and fallback values ([e33e4a5](https://github.com/Wfelipe2011/territory-manager-v2/commit/e33e4a5d0eb5d22e63df038da3657c6a2b6b217c))
* **dashboard:** correct date format in SQL query to include day detail ([b1019ae](https://github.com/Wfelipe2011/territory-manager-v2/commit/b1019ae1220090ca9de0ff26b2a0c0098505b877))
* evita hang do terminal após os testes (reconnect órfão e trap de limpeza) ([3dc27dc](https://github.com/Wfelipe2011/territory-manager-v2/commit/3dc27dc444877f7d7006eec160384a69e202b06f))
* **house and territory services:** filter out houses with number 'ghost' in BlockSignatureDTO and HouseService, and adjust logic in TerritoryService to account for ghost houses ([a64b239](https://github.com/Wfelipe2011/territory-manager-v2/commit/a64b239ff87697e14f3cb6d95a97fb1e9d474a50))
* **realtime:** subscribe to SSE subject before presence transaction ([a3e0545](https://github.com/Wfelipe2011/territory-manager-v2/commit/a3e0545fb4377cb4ae1a7da4deda746ba50731fd))
* **records:** add distinct to SQL query to prevent duplicate entries and include update date filters for accuracy ([cffbba0](https://github.com/Wfelipe2011/territory-manager-v2/commit/cffbba0a8b24380691bf085a5f4cd6462400451a))
* remove CacheInterceptor global e corrige TTL do CacheModule (ms) ([a3f2655](https://github.com/Wfelipe2011/territory-manager-v2/commit/a3f26553e7cb04ace2913a03d8e504f605298181))
* **territory:** handle potential errors when deleting file by URL in TerritoryServiceV2 ([1f3ea81](https://github.com/Wfelipe2011/territory-manager-v2/commit/1f3ea815635c9bd6f097778efc61aaa12309d568))
* **transactions.controller:** update fixed server cost from 683.88 to 1083.88 to reflect accurate expenses ([c1535c3](https://github.com/Wfelipe2011/territory-manager-v2/commit/c1535c31b3bd25ad453cc0d3987b391bf762fc77))
* update server message and adjust date calculations in house and round services - Change server status message from "Homologação" to "Produção".- Modify time difference check from days to hours in house service.- Update round service to get start date based on tenant ID, replacing a hardcoded value.- Enhance leave letter condition to include theme check for default mode ([3d47419](https://github.com/Wfelipe2011/territory-manager-v2/commit/3d47419668bc82238ef6df0361d480b63e3689e9))
* **upload-territory:** ensure nameTerritory is a string in createTerritory method ([b570459](https://github.com/Wfelipe2011/territory-manager-v2/commit/b57045934b2c45a932297a918e98d141d527792f))
* **upload-territory:** handle missing legend with default value and clear observations field ([1da5f02](https://github.com/Wfelipe2011/territory-manager-v2/commit/1da5f02cb0d105949d752b5751dfbc0027531181))
* **UploadTerritoryUseCase:** ensure territory name is a string when creating new territory ([394a417](https://github.com/Wfelipe2011/territory-manager-v2/commit/394a4170e049b131480ed2fc5768c486b5dced7a))


### Performance

* **docker-compose:** increase CPU and memory limits for acceptance service ([4719b3d](https://github.com/Wfelipe2011/territory-manager-v2/commit/4719b3db2ae58b5f2a9e0208d51ad721e053bb6e))


### Refactoring

* **AddressBlockService:** extract address upsert logic into separate method for improved readability and maintainability ([6c75a50](https://github.com/Wfelipe2011/territory-manager-v2/commit/6c75a50a9b7b38f96439678c7ed373a926a27c0d))
* **app.controller:** remove unnecessary interval adjustment from last_change_utc_minus3 calculation ([98186fc](https://github.com/Wfelipe2011/territory-manager-v2/commit/98186fc35fcc6d1c314fc62450d804d02d0d1945))
* **app:** remove unused ServeStaticModule and clean up formatting in AppModule ([d7c06f2](https://github.com/Wfelipe2011/territory-manager-v2/commit/d7c06f224b474f8032df4d4b84c055215c201e30))
* **app:** remove unused ServeStaticModule and join import from app.module.ts ([7efb291](https://github.com/Wfelipe2011/territory-manager-v2/commit/7efb291173d5f19191769ca3e7a586413021ef8c))
* **auth:** change hashPassword to return an object containing the hashed password ([902fcb5](https://github.com/Wfelipe2011/territory-manager-v2/commit/902fcb5eb8687ac2260c0b01eed03715fdb95702))
* **controller:** replace logger calls with class logger instance in HouseController and add logger in PrismaService and AppController constructors ([8b98cc3](https://github.com/Wfelipe2011/territory-manager-v2/commit/8b98cc370e0d6e98f3f74c3aaee2008629460b01))
* initialize loggers in controllers and add console logs in report creation method ([36f192f](https://github.com/Wfelipe2011/territory-manager-v2/commit/36f192fac51d623c8032b7b36dbaf69a6be9d63e))
* Make zipCode optional in AddressDto and UpsertAddressDto, update house mapping in TerritoryService to filter out 'ghost' entries ([a0eb714](https://github.com/Wfelipe2011/territory-manager-v2/commit/a0eb714e4784fdcb4494ebaae81f6856c8ca8273))
* remove outdated comment from healthCheck method in AppController ([4969063](https://github.com/Wfelipe2011/territory-manager-v2/commit/4969063314f72f5f791f41e21f75445a2681bf06))
* remove unnecessary tenant deletion from upload territory use case ([7d4a32b](https://github.com/Wfelipe2011/territory-manager-v2/commit/7d4a32b4241d227ce1869f807d4a6e730c31e524))
* **round.service:** simplify getThemeRound method and update round model reference ([97e9552](https://github.com/Wfelipe2011/territory-manager-v2/commit/97e9552c0f70ec5b7571c9c89fe903707f8563c7))
* simplify territory address creation logic in UploadTerritoryUseCase ([45b6d57](https://github.com/Wfelipe2011/territory-manager-v2/commit/45b6d57996f26665bdbdacc55f7acef886fd100e))
* **territory:** remove UploadGateway references in TerritoryModule and UploadTerritoryUseCase ([6411b5d](https://github.com/Wfelipe2011/territory-manager-v2/commit/6411b5d9724b2958535b6904fbbeb14d70d0b286))
* **territory:** simplify query in TerritoryService by conditionally including type_id filter ([f6f8316](https://github.com/Wfelipe2011/territory-manager-v2/commit/f6f8316adfc378b30350939ca8f593c9381d3e00))
* Update event gateway cron decorator and refine territory service query for distinct selection and ghost filter ([04dbe75](https://github.com/Wfelipe2011/territory-manager-v2/commit/04dbe751ed5f5a7e47333b584ffe4f460b810404))
* update getDataRows to handle multiple sheets and parse each sheet's data properly ([de623de](https://github.com/Wfelipe2011/territory-manager-v2/commit/de623deca2c59b5219b2ba7001209b1bb1fb20cf))
* Update RequestUser to RequestSignature in controller ([8fb2e38](https://github.com/Wfelipe2011/territory-manager-v2/commit/8fb2e381da415761b2fe961dbe58f359ccf30f42))

## 1.0.0 (2026-08-11)


### Features

* Add 'round' and 'tenantId' properties to RequestSignature ([5b88b90](https://github.com/Wfelipe2011/territory-manager-v2/commit/5b88b9082e813e76e902b7e29a4ed20eb563c46a))
* add `theme_mode` column and route to fetch current theme ([b39cebe](https://github.com/Wfelipe2011/territory-manager-v2/commit/b39cebeb87f1bd40b09726cc40387685114e34a3))
* add city and state columns to multi_tenancy table and improve health check logic- Add `city` and `state` columns to the `multi_tenancy` table with default values.- Refactor the health check method in the AppController to utilize helper methods for retrieving database and system information.- Enhance performance by using `Promise.all` for concurrent database queries ([f429157](https://github.com/Wfelipe2011/territory-manager-v2/commit/f42915734f5e265a82072e2529124fe7521eb8e1))
* add Firebase integration and v2 territory endpoints with pagination support- Updated package.json to include Firebase and Multer dependencies.- Introduced FirebaseService for file uploads to Firebase Storage.- Added versioning support with V2 for territory endpoints.- Implemented pagination parameters in TerritoryServiceV2.- Created contracts for find-all parameters validation ([ada4ce9](https://github.com/Wfelipe2011/territory-manager-v2/commit/ada4ce9b42a7e864ad0f71c86c40d34b370c6934))
* add IsOptional validation to zipCode field in UpsertAddressDto ([1f13458](https://github.com/Wfelipe2011/territory-manager-v2/commit/1f1345848b41376751aa84f7ca3201fac72ee449))
* add system information retrieval to health check endpoint ([c457125](https://github.com/Wfelipe2011/territory-manager-v2/commit/c45712598ebb93378ef13fbd03e3c68625ed49ea))
* add territoryBlockAddressId to UpsertHouseInput and related services ([dc0df80](https://github.com/Wfelipe2011/territory-manager-v2/commit/dc0df807a075b92aa362f89eb2cbff2bf9884ad3))
* add theme colors and refactor AddressBlockService and RoundService to utilize them ([bacc2a1](https://github.com/Wfelipe2011/territory-manager-v2/commit/bacc2a1b533229741732e3fbb163d1591d133dc4))
* **address:** add address fetching functionality and API endpoint for all addresses ([0d6b278](https://github.com/Wfelipe2011/territory-manager-v2/commit/0d6b2787f164a2813688cc8f152ad6dcf4dc2f33))
* **app:** add city field to congregation query in AppController ([0682d62](https://github.com/Wfelipe2011/territory-manager-v2/commit/0682d6265fd67b2f4cb2003095a5382f63442461))
* **app:** add image upload endpoint with validation and Firebase integrationIntroduces a new POST /:id/upload endpoint allowing image uploads with size and type restrictions. Uses FileInterceptor for file handling and FirebaseUploadService for storage, mapping specific IDs to storage paths. Adds FirebaseModule for dependency injection and updates app module providers accordingly. Enhances server functionality with secure, validated image uploads ([1cbf995](https://github.com/Wfelipe2011/territory-manager-v2/commit/1cbf9955daf0ab373309ba816b7a208232c233a7))
* **auth:** add hashPassword method and endpoint to AuthController ([f1af078](https://github.com/Wfelipe2011/territory-manager-v2/commit/f1af0788b5dcdb8ce2692684afa81989fe80a9b0))
* **auth:** normalize email to lowercase in login and password recovery methods ([b4a1090](https://github.com/Wfelipe2011/territory-manager-v2/commit/b4a1090c8116d803fe6b18ecd2bd185b36fdd6d8))
* **auth:** update resetPassword method to use email instead of token for password reset and return a JWT token ([d08660d](https://github.com/Wfelipe2011/territory-manager-v2/commit/d08660dfe34af23d9ca8fd85386c1b706a5d6aa7))
* **block:** add address management and territory block association features with Prisma integration ([12bc2d7](https://github.com/Wfelipe2011/territory-manager-v2/commit/12bc2d7df1b631692afbd4e49d0645ff402ee00b))
* **block:** add deleteBlock feature to remove blocks and dependencies ([a591fbc](https://github.com/Wfelipe2011/territory-manager-v2/commit/a591fbc4d4f0dae4dfd41a9300d4445458c1cace))
* **block:** add Swagger decorators for API documentation in BlockController and UpsertBlockDto ([388c11f](https://github.com/Wfelipe2011/territory-manager-v2/commit/388c11fc35aec4243d450c469c940543775e5b98))
* **dashboard:** add dashboard module with controller and service for marked houses and territory details retrieval ([0a20cf4](https://github.com/Wfelipe2011/territory-manager-v2/commit/0a20cf418401e05c8dac06b6196d40f0b062d7a8))
* **dashboard:** enhance findMarkedHouses and territoryDetails to dynamically include all types in the SQL query results ([8241e5b](https://github.com/Wfelipe2011/territory-manager-v2/commit/8241e5be6fdbced032973bcb7a44fd84e828892b))
* **database:** add completed_date column to round model and update related queries- Add new column completed_date to the round table in migration.sql- Update schema.prisma to include completed_date in the round model- Modify dashboard.service.ts to query based on completed_date- Update Houses interface to include completed_date- Adjust house.service.ts to utilize completed_date for status updates ([2e9f99c](https://github.com/Wfelipe2011/territory-manager-v2/commit/2e9f99c6bae52b8cc9ffed4092e658fe3afa6326))
* **database:** create territory_block_address table and update related modelsAdd new migration for territory_block_address table and update house model to include territory_block_address_id. Update Prisma schema for relationships and foreign keys. Create a script to populate the new table based on existing house data. Refactor PrismaService into a dedicated module with middleware for connection management. Adjust imports throughout the application to use the new Prisma module structure ([1342ecb](https://github.com/Wfelipe2011/territory-manager-v2/commit/1342ecbb7004adee3397c6dcf34df2c0eb106c76))
* enhance house sorting logic to prioritize numeric house numbers and maintain order ([5a30468](https://github.com/Wfelipe2011/territory-manager-v2/commit/5a30468a385a5b9f182d135bd97ce74bcae6801b))
* enhance house sorting logic to prioritize numeric values in house numbers ([accdc28](https://github.com/Wfelipe2011/territory-manager-v2/commit/accdc2818e558c8870dd0d6813c7307de84085a2))
* **firebase:** add Firebase table and integrate with Prisma service for dynamic config loading and file deletion functionality ([6299e06](https://github.com/Wfelipe2011/territory-manager-v2/commit/6299e06f1caaba3f6ec2f4b3a4f926efc9a1b418))
* **gateway:** implement WebSocket gateway initialization and socket management logic- Add OnGatewayInit interface to EventsGateway class- Log initialization message when gateway is created- Modify socket handling to upsert instead of create- Change cron job to check for disconnected sockets every 30 seconds and emit events for user count updates in rooms ([7566a20](https://github.com/Wfelipe2011/territory-manager-v2/commit/7566a20b59a50ca2f459b6fca8f4ba0098da8dcb))
* **house, records:** add records module and upsert house input DTO for better data handling and validation ([5d69479](https://github.com/Wfelipe2011/territory-manager-v2/commit/5d69479a0615ce6bb4a5f747f5ae6d420ecdad9a))
* **house:** add custom hours tenancy logic to HouseService for tenant validation ([4dbee7e](https://github.com/Wfelipe2011/territory-manager-v2/commit/4dbee7e40132c9d30cd39347a23dcd80fb0d1558))
* **house:** add HouseWorkerService for ghost house management and improve error handling in AddressBlockService ([6a235cc](https://github.com/Wfelipe2011/territory-manager-v2/commit/6a235ccab94f75e1c2fbbe5a6418eb11fcbb1ca4))
* **house:** add UpdateHouseOrder feature for updating house order in the controller and service ([c9884fb](https://github.com/Wfelipe2011/territory-manager-v2/commit/c9884fb4c2d2a26e70116d0f097cd538a22ba765))
* implement getCustomHoursTenancy function and integrate it into HouseService and SignatureService for dynamic expiration time calculation ([10b482f](https://github.com/Wfelipe2011/territory-manager-v2/commit/10b482f0913f46539aa156de0c5604d8ec715a14))
* implement quarantine classification for houses and update related logic ([94785bf](https://github.com/Wfelipe2011/territory-manager-v2/commit/94785bf0e0cac4701868c74450f0fcfec41d7042))
* **logging:** add Loggable decorator for request logging and enhance RequestSignature interface with userId and userName fields ([8c99248](https://github.com/Wfelipe2011/territory-manager-v2/commit/8c99248dbec20c1c15e44231834f5bcaf201d7f3))
* **report:** add CreateReport DTO and current user decorator for report creation validation and user extraction ([594e909](https://github.com/Wfelipe2011/territory-manager-v2/commit/594e909d704dfe624762ea55454538595b96d2f0))
* **report:** add functionality to remove ghost houses in report approval process ([da07235](https://github.com/Wfelipe2011/territory-manager-v2/commit/da072350ccbb01d1daf3ae0dff348eedb1cbba79))
* **report:** add report management functionality with enum and database migrations ([13dd606](https://github.com/Wfelipe2011/territory-manager-v2/commit/13dd606e7d6250758b02abc3eec6d66c2d807ec8))
* **report:** update report controller to use UserToken for current user context and enforce tenantId checks ([0691bac](https://github.com/Wfelipe2011/territory-manager-v2/commit/0691bac4a09f88cca5f4314fd4a35f4a891e9d8f))
* **round:** add endpoint to retrieve round info by round number and implement corresponding service method ([f751fe6](https://github.com/Wfelipe2011/territory-manager-v2/commit/f751fe6e2b2ca39ac61e2fc08ee1103daeb35a03))
* **round:** add finish and start round endpoints with body validation and theme support ([4ef58ff](https://github.com/Wfelipe2011/territory-manager-v2/commit/4ef58ff0b87b21dce23656dd696ea34472b92396))
* **round:** add leave_letter column to round table and update related DTOs and services ([fb1b02f](https://github.com/Wfelipe2011/territory-manager-v2/commit/fb1b02fc116229e22f4caf7c2eeb13ad45934af5))
* **round:** add round_info table and update related logic in round controller and service ([a574ce6](https://github.com/Wfelipe2011/territory-manager-v2/commit/a574ce6f162381f9ed7ee04b408494ae66218217))
* **round:** add type column to round_info and update related logic- Introduce new "type" column in round_info table with default value 'Residencial'.- Update CreateRoundDto to include typeId for better handling of round types.- Modify RoundService and RoundController to accommodate new type logic.- Adjust tenant creation script for consistent naming and phone number.- Ensure all related methods utilize the new type information ([360e009](https://github.com/Wfelipe2011/territory-manager-v2/commit/360e00947786c8071e4fa229d8d43ec46443f136))
* **signature:** add round parameter to createSignatureTerritoryBlock endpoint ([fa2e578](https://github.com/Wfelipe2011/territory-manager-v2/commit/fa2e578fd057b903474b443d3e1bb2933f054cd8))
* **signature:** add round parameter to createSignatureTerritoryBlock endpoint ([42b4f2f](https://github.com/Wfelipe2011/territory-manager-v2/commit/42b4f2f4d5d6357b6f112f111eb95430236c7f79))
* **signature:** Add round parameter to signature generation ([4fd3c29](https://github.com/Wfelipe2011/territory-manager-v2/commit/4fd3c29d81a703146c253c16d0a37a1534fcda41))
* **territory:** add find-one parameters and territory edit output interfaces, and implement territory edit retrieval logic in the controller and service ([5bf66a9](https://github.com/Wfelipe2011/territory-manager-v2/commit/5bf66a925e7ba50ba838e88da07eeedeeb93df28))
* **territory:** add search and type parameters to FindAllParams for enhanced filtering functionality ([1673d88](https://github.com/Wfelipe2011/territory-manager-v2/commit/1673d887e484e9c79151322e8a7d3b8ff5a3e848))
* **territory:** add typeId property to TerritoryAllOutput and RawTerritoryAll interfaces ([0de8df1](https://github.com/Wfelipe2011/territory-manager-v2/commit/0de8df158462bfe4fb04efdf86154c4ad36bb605))
* **territory:** add updateAt property and sorting for blocks in TerritoryOneOutput class ([1db6f2b](https://github.com/Wfelipe2011/territory-manager-v2/commit/1db6f2ba0e56f32eb0bac0e1f1e52ff2751d5181))
* **territory:** implement territory creation endpoint with validationAdds a new endpoint to create a territory in the TerritoryController, utilizing the CreateTerritoryParams class for request validation. Implements OnModuleInit in FirebaseService to initialize Firebase Admin SDK and connect to the database, enhancing service reliability ([ec89c5d](https://github.com/Wfelipe2011/territory-manager-v2/commit/ec89c5d13e768663e74834dfae9c9bfacef2caf6))
* **territory:** implement upload functionality for territory data with WebSocket progress notifications and create UploadGateway for real-time updates ([7a309ea](https://github.com/Wfelipe2011/territory-manager-v2/commit/7a309ea7a8202cf30a7f13d0e759a6c9b0619adf))
* **transactions:** add PayPal transactions management and CSV upload functionality- Introduce new model for PayPal transactions in the database.- Implement TransactionsController for handling CSV uploads and balance retrieval.- Create TransactionsService for saving transactions to the database.- Add HttpModule to app module for external HTTP requests.- Include necessary dependencies in package.json ([1e77451](https://github.com/Wfelipe2011/territory-manager-v2/commit/1e77451e5d2b8f73ea001f65d4207ccd2fa32b34))
* **transactions:** add public decorator to getBalance endpoint ([4a41f9c](https://github.com/Wfelipe2011/territory-manager-v2/commit/4a41f9c00c5f629728fbbae7658f2831b0e34bce))
* **transactions:** update date format from DD/MM/YYYY to YYYY-MM-DD in transactions processing ([f65f474](https://github.com/Wfelipe2011/territory-manager-v2/commit/f65f47492e6631103d00b72daaae2ac0be3036f8))
* update leaveLetter logic to ensure correct evaluation based on house rounds ([f61e2cb](https://github.com/Wfelipe2011/territory-manager-v2/commit/f61e2cbdfa0c2863192473d45a761b2186b84a77))
* **upload-territory:** add populateTerritoryAddress method to link houses with territory addresses and log progress during upload process ([602a5f9](https://github.com/Wfelipe2011/territory-manager-v2/commit/602a5f94245fabf1b98c245a0fbc23a15b7707f6))


### Bug Fixes

* **address-block:** increase similarity threshold for address matching query ([27cccc0](https://github.com/Wfelipe2011/territory-manager-v2/commit/27cccc08c914253815336d24c4922ea9740115bf))
* **app.controller:** update signature expiration check to only count future signatures ([a7d35b3](https://github.com/Wfelipe2011/territory-manager-v2/commit/a7d35b3cf7e342c1147008ad9a05583115b0c266))
* **dashboard.service:** handle errors in database queries with console logging and fallback values ([e33e4a5](https://github.com/Wfelipe2011/territory-manager-v2/commit/e33e4a5d0eb5d22e63df038da3657c6a2b6b217c))
* **dashboard:** correct date format in SQL query to include day detail ([b1019ae](https://github.com/Wfelipe2011/territory-manager-v2/commit/b1019ae1220090ca9de0ff26b2a0c0098505b877))
* **house and territory services:** filter out houses with number 'ghost' in BlockSignatureDTO and HouseService, and adjust logic in TerritoryService to account for ghost houses ([a64b239](https://github.com/Wfelipe2011/territory-manager-v2/commit/a64b239ff87697e14f3cb6d95a97fb1e9d474a50))
* **records:** add distinct to SQL query to prevent duplicate entries and include update date filters for accuracy ([cffbba0](https://github.com/Wfelipe2011/territory-manager-v2/commit/cffbba0a8b24380691bf085a5f4cd6462400451a))
* **territory:** handle potential errors when deleting file by URL in TerritoryServiceV2 ([1f3ea81](https://github.com/Wfelipe2011/territory-manager-v2/commit/1f3ea815635c9bd6f097778efc61aaa12309d568))
* **transactions.controller:** update fixed server cost from 683.88 to 1083.88 to reflect accurate expenses ([c1535c3](https://github.com/Wfelipe2011/territory-manager-v2/commit/c1535c31b3bd25ad453cc0d3987b391bf762fc77))
* update server message and adjust date calculations in house and round services - Change server status message from "Homologação" to "Produção".- Modify time difference check from days to hours in house service.- Update round service to get start date based on tenant ID, replacing a hardcoded value.- Enhance leave letter condition to include theme check for default mode ([3d47419](https://github.com/Wfelipe2011/territory-manager-v2/commit/3d47419668bc82238ef6df0361d480b63e3689e9))
* **upload-territory:** ensure nameTerritory is a string in createTerritory method ([b570459](https://github.com/Wfelipe2011/territory-manager-v2/commit/b57045934b2c45a932297a918e98d141d527792f))
* **upload-territory:** handle missing legend with default value and clear observations field ([1da5f02](https://github.com/Wfelipe2011/territory-manager-v2/commit/1da5f02cb0d105949d752b5751dfbc0027531181))
* **UploadTerritoryUseCase:** ensure territory name is a string when creating new territory ([394a417](https://github.com/Wfelipe2011/territory-manager-v2/commit/394a4170e049b131480ed2fc5768c486b5dced7a))


### Performance

* **docker-compose:** increase CPU and memory limits for acceptance service ([4719b3d](https://github.com/Wfelipe2011/territory-manager-v2/commit/4719b3db2ae58b5f2a9e0208d51ad721e053bb6e))


### Refactoring

* **AddressBlockService:** extract address upsert logic into separate method for improved readability and maintainability ([6c75a50](https://github.com/Wfelipe2011/territory-manager-v2/commit/6c75a50a9b7b38f96439678c7ed373a926a27c0d))
* **app.controller:** remove unnecessary interval adjustment from last_change_utc_minus3 calculation ([98186fc](https://github.com/Wfelipe2011/territory-manager-v2/commit/98186fc35fcc6d1c314fc62450d804d02d0d1945))
* **app:** remove unused ServeStaticModule and clean up formatting in AppModule ([d7c06f2](https://github.com/Wfelipe2011/territory-manager-v2/commit/d7c06f224b474f8032df4d4b84c055215c201e30))
* **app:** remove unused ServeStaticModule and join import from app.module.ts ([7efb291](https://github.com/Wfelipe2011/territory-manager-v2/commit/7efb291173d5f19191769ca3e7a586413021ef8c))
* **auth:** change hashPassword to return an object containing the hashed password ([902fcb5](https://github.com/Wfelipe2011/territory-manager-v2/commit/902fcb5eb8687ac2260c0b01eed03715fdb95702))
* **controller:** replace logger calls with class logger instance in HouseController and add logger in PrismaService and AppController constructors ([8b98cc3](https://github.com/Wfelipe2011/territory-manager-v2/commit/8b98cc370e0d6e98f3f74c3aaee2008629460b01))
* initialize loggers in controllers and add console logs in report creation method ([36f192f](https://github.com/Wfelipe2011/territory-manager-v2/commit/36f192fac51d623c8032b7b36dbaf69a6be9d63e))
* Make zipCode optional in AddressDto and UpsertAddressDto, update house mapping in TerritoryService to filter out 'ghost' entries ([a0eb714](https://github.com/Wfelipe2011/territory-manager-v2/commit/a0eb714e4784fdcb4494ebaae81f6856c8ca8273))
* remove outdated comment from healthCheck method in AppController ([4969063](https://github.com/Wfelipe2011/territory-manager-v2/commit/4969063314f72f5f791f41e21f75445a2681bf06))
* remove unnecessary tenant deletion from upload territory use case ([7d4a32b](https://github.com/Wfelipe2011/territory-manager-v2/commit/7d4a32b4241d227ce1869f807d4a6e730c31e524))
* **round.service:** simplify getThemeRound method and update round model reference ([97e9552](https://github.com/Wfelipe2011/territory-manager-v2/commit/97e9552c0f70ec5b7571c9c89fe903707f8563c7))
* simplify territory address creation logic in UploadTerritoryUseCase ([45b6d57](https://github.com/Wfelipe2011/territory-manager-v2/commit/45b6d57996f26665bdbdacc55f7acef886fd100e))
* **territory:** remove UploadGateway references in TerritoryModule and UploadTerritoryUseCase ([6411b5d](https://github.com/Wfelipe2011/territory-manager-v2/commit/6411b5d9724b2958535b6904fbbeb14d70d0b286))
* **territory:** simplify query in TerritoryService by conditionally including type_id filter ([f6f8316](https://github.com/Wfelipe2011/territory-manager-v2/commit/f6f8316adfc378b30350939ca8f593c9381d3e00))
* Update event gateway cron decorator and refine territory service query for distinct selection and ghost filter ([04dbe75](https://github.com/Wfelipe2011/territory-manager-v2/commit/04dbe751ed5f5a7e47333b584ffe4f460b810404))
* update getDataRows to handle multiple sheets and parse each sheet's data properly ([de623de](https://github.com/Wfelipe2011/territory-manager-v2/commit/de623deca2c59b5219b2ba7001209b1bb1fb20cf))
* Update RequestUser to RequestSignature in controller ([8fb2e38](https://github.com/Wfelipe2011/territory-manager-v2/commit/8fb2e381da415761b2fe961dbe58f359ccf30f42))
