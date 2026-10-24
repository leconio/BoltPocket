# Third-party notices

## QuickJS

The files in `cpp/quickjs/` are the exact QuickJS source snapshot distributed
inside the immutable npm artifact `react-native-quickjs-sandbox@1.0.1`
(`sha512-YRaoIkLaRUh/21XRyvt1GIiI25m55IilICF1lFrQisQezh+NCRxL8PONFXhTqdGc6fYoSj8PDYVGgYzcic6BcQ==`).
The source is built directly into the Android and iOS modules; installation
does not download QuickJS. `vendor-manifest.json` records every vendored file
hash and `pnpm verify:vendor` verifies it.

QuickJS is licensed under the MIT License:

> Copyright (c) 2017-2025 Fabrice Bellard
> Copyright (c) 2017-2025 Charlie Gordon
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in
> all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

Individual QuickJS files retain their more specific copyright years.

## react-native-quickjs-sandbox source distribution

The fixed source artifact used to obtain the QuickJS snapshot is MIT-licensed:

> React Native QuickJS Sandbox Wrapper — Copyright (c) 2026 ByteKen

BoltPocket does not expose or compile that package's synchronous JSI evaluation
API. Its unbounded wrapper was replaced with the bounded asynchronous Expo
module in this package.
