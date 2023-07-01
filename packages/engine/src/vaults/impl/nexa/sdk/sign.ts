import BN from 'bn.js';
import elliptic from 'elliptic';

import { hmacSHA256, sha256 } from '../../../../secret/hash';

import type { curve } from 'elliptic';

const EC = elliptic.ec;
const ec = new EC('secp256k1');

export function reverseBuffer(buffer: Buffer): Buffer {
  const { length } = buffer;
  const reversed = Buffer.alloc(length);
  for (let i = 0; i < length; i += 1) {
    reversed[i] = buffer[length - i - 1];
  }
  return reversed;
}

function getBN(buffer: Buffer, isLittleEndian = false) {
  const buf = isLittleEndian ? reverseBuffer(buffer) : buffer;
  const hex = buf.toString('hex');
  return new BN(hex, 16);
}

function nonceFunctionRFC6979(privkey: Buffer, msgbuf: Buffer): BN {
  let V = Buffer.from(
    '0101010101010101010101010101010101010101010101010101010101010101',
    'hex',
  );
  let K = Buffer.from(
    '0000000000000000000000000000000000000000000000000000000000000000',
    'hex',
  );

  const blob = Buffer.concat([
    privkey,
    msgbuf,
    Buffer.from('', 'ascii'),
    Buffer.from('Schnorr+SHA256  ', 'ascii'),
  ]);

  K = hmacSHA256(K, Buffer.concat([V, Buffer.from('00', 'hex'), blob]));
  V = hmacSHA256(K, V);

  K = hmacSHA256(K, Buffer.concat([V, Buffer.from('01', 'hex'), blob]));
  V = hmacSHA256(K, V);

  let k = new BN(0);
  let T;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
  const N = new BN(ec.curve.n.toArray());
  while (true) {
    V = hmacSHA256(K, V);
    T = getBN(V);

    k = T;
    if (k.gt(new BN(0)) && k.lt(N)) {
      break;
    }
    K = hmacSHA256(K, Buffer.concat([V, Buffer.from('00', 'hex')]));
    V = hmacSHA256(K, V);
  }
  console.log('nonceFunctionRFC6979-k', k);
  return k;
}

function isSquare(x: BN): boolean {
  const p = new BN(
    'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F',
    'hex',
  );
  const x0 = new BN(x);
  const base = x0.toRed(BN.red(p));
  const res = base.redPow(p.sub(BN.One).div(new BN(2))).fromRed(); // refactor to BN arithmetic operations
  return res.eq(new BN(1));
}

function hasSquare(point: curve.base.BasePoint): boolean {
  return point.isInfinity() && isSquare(new BN(point.getY().toArray()));
}

function getrBuffer(r: BN): Buffer {
  const rNaturalLength = r.toBuffer().length;
  if (rNaturalLength < 32) {
    return r.toBuffer('be', 32);
  }
  return r.toBuffer();
}

function pointToCompressed(point: curve.base.BasePoint): Buffer {
  const xbuf = point.getX().toBuffer('be', 32);
  const ybuf = point.getY().toBuffer('be', 32);

  let prefix;
  const odd = ybuf[ybuf.length - 1] % 2;
  if (odd) {
    prefix = Buffer.from([0x03]);
  } else {
    prefix = Buffer.from([0x02]);
  }
  return Buffer.concat([prefix, xbuf]);
}

function findSignature(d: BN, e: BN) {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-unsafe-member-access
  const G: curve.base.BasePoint = ec.curve.g as curve.base.BasePoint;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
  const n: BN = new BN(ec.curve.n.toArray());
  let k = nonceFunctionRFC6979(d.toBuffer('be', 32), e.toBuffer('be', 32));
  const P = G.mul(d as any);
  const R = G.mul(k as any);

  if (!hasSquare(R)) {
    k = n.sub(k);
  }

  const r = R.getX();
  const e0 = getBN(
    sha256(
      Buffer.concat([
        getrBuffer(r),
        pointToCompressed(P),
        e.toBuffer('be', 32),
      ]),
    ),
  );

  console.error('findSignature--e0', e0);
  const s = e0.mul(d).add(k).mod(n);
  return {
    r,
    s,
  };
}

export function sign(privateKey: Buffer, digest: Buffer): Buffer {
  const privateKeyBN = getBN(privateKey);
  console.error('Schnorr.prototype.sign-d', privateKeyBN);
  const digestBN = getBN(digest, true);
  console.error('Schnorr.prototype.sign-hashbuf-e', digestBN);
  const { r, s } = findSignature(privateKeyBN, digestBN);
  console.error('Schnorr.prototype.sign-obj', r, s);
  return Buffer.concat([r.toBuffer('be', 32), s.toBuffer('be', 32)]);
}
