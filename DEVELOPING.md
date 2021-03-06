# Developing

## Pre-requisites

1. We are using Node 8. If you need to work with multiple versions of Node, you
   might consider using [nvm](https://github.com/creationix/nvm).
2. This repository uses [yarn](https://yarnpkg.com/) to manage node
   dependencies. Please install yarn globally by using
   `npm install --global yarn`.

## Typical workflow

You would only do the following once, right after you cloned the repository:

1. Clone this repository from git.
2. `cd` into `sfdx-core`.
3. We develop on the `develop` branch and release from the `master` branch. At
   this point, you should do initiate a `git checkout -t origin/develop`.
4. `yarn` to bring in all the top-level dependencies.
5. Open the project in your editor of choice.

When you are ready to commit:

1. We enforce a standard commit message format. We recommend using
   [commitizen](https://github.com/commitizen/cz-cli) by installing it with
   `yarn global add commitizen`, then commit using `git cz`, which will prompt
   you questions to format the commit message.
2. Before commit and push, [husky](https://github.com/typicode/husky) will run
   several hooks to ensure the message and that everything lints and compiles
   properly.

## List of Useful commands

### `yarn compile`

This compiles the typescript to javascript.

### `yarn clean`

This cleans all generated files and directories. Run `yarn cleal-all` will also
clean up the node_module directories.

### `yarn test`

This tests the typescript using ts-node.

### `yarn lint`

This lints all the typescript. If there are no errors/warnings
from tslint, then you get a clean output. But, if they are errors from tslint,
you will see a long error that can be confusing – just focus on the tslint
errors. The results of this is deeper than what the tslint extension in VS Code
does because of [semantic lint
rules](https://palantir.github.io/tslint/usage/type-checking/) which requires a
tsconfig.json to be passed to tslint.
