import koffi from 'koffi';

// OopType is uint64_t in C; koffi maps this to BigInt in JS
const OopType = 'uint64';

// GciErrSType struct (from gci.ht / gcicmn.ht)
const GCI_ERR_STR_SIZE = 1024;
const GCI_MAX_ERR_ARGS = 10;

const GciErrSType = koffi.struct('GciErrSType', {
  category:     OopType,
  context:      OopType,
  exceptionObj: OopType,
  args:         koffi.array(OopType, GCI_MAX_ERR_ARGS),
  number:       'int',
  argCount:     'int',
  fatal:        'uchar',
  message:      koffi.array('char', GCI_ERR_STR_SIZE + 1),
  reason:       koffi.array('char', GCI_ERR_STR_SIZE + 1),
});

// GciSession is typedef void* in gcits.hf
const GciSessionOpaque = koffi.opaque('GciSession');
const GciSessionPtr = koffi.pointer('GciSessionPtr', GciSessionOpaque);

// GciTsObjInfo struct (from gcits.ht)
const GciTsObjInfoStruct = koffi.struct('GciTsObjInfo', {
  objId:                  OopType,
  objClass:               OopType,
  objSize:                'int64',
  namedSize:              'int',
  access:                 'uint',
  objectSecurityPolicyId: 'ushort',
  _bits:                  'ushort',
});

// GciTsGbjInfo struct — extends GciTsObjInfo with extraBits and bytesReturned
const GciTsGbjInfoStruct = koffi.struct('GciTsGbjInfo', {
  objId:                  OopType,
  objClass:               OopType,
  objSize:                'int64',
  namedSize:              'int',
  access:                 'uint',
  objectSecurityPolicyId: 'ushort',
  _bits:                  'ushort',
  extraBits:              'uint64',
  bytesReturned:          'int64',
});

export interface GciObjInfo {
  objId: bigint;
  objClass: bigint;
  objSize: bigint;
  namedSize: number;
  access: number;
  objectSecurityPolicyId: number;
  _bits: number;
}

export interface GciGbjInfo extends GciObjInfo {
  extraBits: bigint;
  bytesReturned: bigint;
}

// GciClampedTravArgsSType — travBuff is an opaque pointer to a raw Buffer
const GciClampedTravArgsStruct = koffi.struct('GciClampedTravArgsSType', {
  clampSpec:      OopType,
  resultOop:      OopType,
  travBuff:       'void *',
  level:          'int',
  retrievalFlags: 'int',
  isRpc:          'int',
});

// StoreTrav union variants for GciTsStoreTravDoTravRefs
const StoreTravPerformArgs = koffi.struct('StoreTravPerformArgs', {
  receiver:      OopType,
  _pad:          koffi.array('char', 24),
  selector:      'const char *',
  args:          'void *',
  numArgs:       'int',
  environmentId: 'ushort',
});

const StoreTravExecStrArgs = koffi.struct('StoreTravExecStrArgs', {
  contextObject: OopType,
  sourceClass:   OopType,
  symbolList:    OopType,
  sourceSize:    'int64',
  source:        'const char *',
  args:          'void *',
  numArgs:       'int',
  environmentId: 'ushort',
});

const StoreTravContinueArgs = koffi.struct('StoreTravContinueArgs', {
  process:           OopType,
  replaceTopOfStack: OopType,
});

const StoreTravDoUnion = koffi.union('StoreTravDoUnion', {
  perform:      StoreTravPerformArgs,
  executestr:   StoreTravExecStrArgs,
  continueArgs: StoreTravContinueArgs,
});

const GciStoreTravDoArgsSType = koffi.struct('GciStoreTravDoArgsSType', {
  doPerform:        'int',
  doFlags:          'int',
  alteredNumOops:   'int',
  alteredCompleted: 'int',
  u:                StoreTravDoUnion,
  storeTravBuff:    'void *',
  alteredTheOops:   'void *',
  storeTravFlags:   'int',
});

// Object report header size (GciObjRepHdrSType): 40 bytes
const OBJ_REP_HDR_SIZE = 40;

export interface GciObjReport {
  objId: bigint;
  oclass: bigint;
  firstOffset: bigint;
  namedSize: number;
  objectSecurityPolicyId: number;
  valueBuffSize: number;
  idxSizeBits: bigint;
  body: Buffer;
}

export interface GciError {
  category: bigint;
  context: bigint;
  exceptionObj: bigint;
  args: bigint[];
  number: number;
  argCount: number;
  fatal: number;
  message: string;
  reason: string;
}

// koffi returns uint64 as Number when the value fits in Number.MAX_SAFE_INTEGER,
// and BigInt otherwise. This helper normalizes to always return BigInt.
function toBigInt(value: number | bigint): bigint {
  return typeof value === 'bigint' ? value : BigInt(value);
}

export class GciLibrary {
  private lib: koffi.IKoffiLib;
  private _GciTsVersion: koffi.KoffiFunction;
  private _GciTsOopIsSpecial: koffi.KoffiFunction;
  private _GciTsFetchSpecialClass: koffi.KoffiFunction;
  private _GciTsOopToChar: koffi.KoffiFunction;
  private _GciTsCharToOop: koffi.KoffiFunction;
  private _GciTsDoubleToSmallDouble: koffi.KoffiFunction;
  private _GciI32ToOop: koffi.KoffiFunction;
  private _GciTsI32ToOop: koffi.KoffiFunction;
  private _GciUtf8To8bit: koffi.KoffiFunction;
  private _GciNextUtf8Character: koffi.KoffiFunction;
  private _GciTsLogin: koffi.KoffiFunction;
  private _GciTsLogout: koffi.KoffiFunction;
  private _GciTsLogin_: koffi.KoffiFunction;
  private _GciTsNbLogin: koffi.KoffiFunction;
  private _GciTsNbLogin_: koffi.KoffiFunction;
  private _GciTsNbLoginFinished: koffi.KoffiFunction;
  private _GciTsNbLogout: koffi.KoffiFunction;
  private _GciTsSessionIsRemote: koffi.KoffiFunction;
  private _GciTsEncrypt: koffi.KoffiFunction;
  private _GciTsAbort: koffi.KoffiFunction;
  private _GciTsBegin: koffi.KoffiFunction;
  private _GciTsCommit: koffi.KoffiFunction;
  private _GciTsContinueWith: koffi.KoffiFunction;
  private _GciTsDoubleToOop: koffi.KoffiFunction;
  private _GciTsOopToDouble: koffi.KoffiFunction;
  private _GciTsI64ToOop: koffi.KoffiFunction;
  private _GciTsOopToI64: koffi.KoffiFunction;
  private _GciTsNewObj: koffi.KoffiFunction;
  private _GciTsNewByteArray: koffi.KoffiFunction;
  private _GciTsNewString_: koffi.KoffiFunction;
  private _GciTsNewString: koffi.KoffiFunction;
  private _GciTsNewSymbol: koffi.KoffiFunction;
  private _GciTsNewUnicodeString_: koffi.KoffiFunction;
  private _GciTsNewUnicodeString: koffi.KoffiFunction;
  private _GciTsNewUtf8String: koffi.KoffiFunction;
  private _GciTsNewUtf8String_: koffi.KoffiFunction;
  private _GciTsFetchUnicode: koffi.KoffiFunction;
  private _GciTsFetchUtf8: koffi.KoffiFunction;
  private _GciTsFetchObjInfo: koffi.KoffiFunction;
  private _GciTsFetchSize: koffi.KoffiFunction;
  private _GciTsFetchVaryingSize: koffi.KoffiFunction;
  private _GciTsFetchClass: koffi.KoffiFunction;
  private _GciTsIsKindOf: koffi.KoffiFunction;
  private _GciTsIsSubclassOf: koffi.KoffiFunction;
  private _GciTsIsKindOfClass: koffi.KoffiFunction;
  private _GciTsIsSubclassOfClass: koffi.KoffiFunction;
  private _GciTsObjExists: koffi.KoffiFunction;
  private _GciTsResolveSymbol: koffi.KoffiFunction;
  private _GciTsResolveSymbolObj: koffi.KoffiFunction;
  private _GciTsExecute: koffi.KoffiFunction;
  private _GciTsExecute_: koffi.KoffiFunction;
  private _GciTsExecuteFetchBytes: koffi.KoffiFunction;
  private _GciTsPerform: koffi.KoffiFunction;
  private _GciTsPerformFetchBytes: koffi.KoffiFunction;
  private _GciTsFetchBytes: koffi.KoffiFunction;
  private _GciTsFetchChars: koffi.KoffiFunction;
  private _GciTsFetchUtf8Bytes: koffi.KoffiFunction;
  private _GciTsStoreBytes: koffi.KoffiFunction;
  private _GciTsFetchOops: koffi.KoffiFunction;
  private _GciTsFetchNamedOops: koffi.KoffiFunction;
  private _GciTsFetchVaryingOops: koffi.KoffiFunction;
  private _GciTsStoreOops: koffi.KoffiFunction;
  private _GciTsStoreNamedOops: koffi.KoffiFunction;
  private _GciTsStoreIdxOops: koffi.KoffiFunction;
  private _GciTsCompileMethod: koffi.KoffiFunction;
  private _GciTsClassRemoveAllMethods: koffi.KoffiFunction;
  private _GciTsProtectMethods: koffi.KoffiFunction;
  private _GciTsBreak: koffi.KoffiFunction;
  private _GciTsCallInProgress: koffi.KoffiFunction;
  private _GciTsClearStack: koffi.KoffiFunction;
  private _GciTsGemTrace: koffi.KoffiFunction;
  private _GciTsNbExecute: koffi.KoffiFunction;
  private _GciTsNbPerform: koffi.KoffiFunction;
  private _GciTsNbResult: koffi.KoffiFunction;
  private _GciTsNbPoll: koffi.KoffiFunction;
  private _GciTsSocket: koffi.KoffiFunction;
  private _GciTsGetFreeOops: koffi.KoffiFunction;
  private _GciTsSaveObjs: koffi.KoffiFunction;
  private _GciTsReleaseObjs: koffi.KoffiFunction;
  private _GciTsReleaseAllObjs: koffi.KoffiFunction;
  private _GciTsAddOopsToNsc: koffi.KoffiFunction;
  private _GciTsRemoveOopsFromNsc: koffi.KoffiFunction;
  private _GciTsPerformFetchOops: koffi.KoffiFunction;
  private _GciTsFetchGbjInfo: koffi.KoffiFunction;
  private _GciTsNewStringFromUtf16: koffi.KoffiFunction;
  private _GciTsDirtyObjsInit: koffi.KoffiFunction;
  private _GciTsFetchTraversal: koffi.KoffiFunction;
  private _GciTsStoreTrav: koffi.KoffiFunction;
  private _GciTsMoreTraversal: koffi.KoffiFunction;
  private _GciTsStoreTravDoTravRefs: koffi.KoffiFunction;
  private _GciTsWaitForEvent: koffi.KoffiFunction;
  private _GciTsCancelWaitForEvent: koffi.KoffiFunction;
  private _GciTsDirtyExportedObjs: koffi.KoffiFunction;
  private _GciTsKeepAliveCount: koffi.KoffiFunction;
  private _GciTsKeyfilePermissions: koffi.KoffiFunction;
  private _GciTsDebugConnectToGem: koffi.KoffiFunction;
  private _GciTsDebugStartDebugService: koffi.KoffiFunction;
  private _GciShutdown: koffi.KoffiFunction;
  private _GciMalloc: koffi.KoffiFunction;
  private _GciFree: koffi.KoffiFunction;
  private _GciHostCallDebuggerMsg: koffi.KoffiFunction;
  private _GciHostFtime: koffi.KoffiFunction;
  private _GciHostMilliSleep: koffi.KoffiFunction;
  private _GciTimeStampMsStr: koffi.KoffiFunction;

  constructor(libraryPath: string) {
    this.lib = koffi.load(libraryPath);
    this._GciTsVersion = this.lib.func(`unsigned int GciTsVersion(_Out_ char *buf, size_t bufSize)`);
    this._GciTsOopIsSpecial = this.lib.func(`int GciTsOopIsSpecial(${OopType} oop)`);
    this._GciTsFetchSpecialClass = this.lib.func(`${OopType} GciTsFetchSpecialClass(${OopType} oop)`);
    this._GciTsOopToChar = this.lib.func(`int GciTsOopToChar(${OopType} oop)`);
    this._GciTsCharToOop = this.lib.func(`${OopType} GciTsCharToOop(unsigned int ch)`);
    this._GciTsDoubleToSmallDouble = this.lib.func(`${OopType} GciTsDoubleToSmallDouble(double aFloat)`);
    this._GciI32ToOop = this.lib.func(`${OopType} GciI32ToOop(int arg)`);
    this._GciTsI32ToOop = this.lib.func(`${OopType} GciTsI32ToOop(int arg)`);
    this._GciUtf8To8bit = this.lib.func(`int GciUtf8To8bit(const char *src, _Out_ char *dest, intptr destSize)`);
    this._GciNextUtf8Character = this.lib.func(`intptr GciNextUtf8Character(const char *src, size_t len, _Out_ unsigned int *chOut)`);
    this._GciShutdown = this.lib.func(`void GciShutdown()`);
    this._GciMalloc = this.lib.func(`void* GciMalloc(size_t length, int lineNum)`);
    this._GciFree = this.lib.func(`void GciFree(void* ptr)`);
    this._GciHostCallDebuggerMsg = this.lib.func(`int GciHostCallDebuggerMsg(const char* msg)`);
    this._GciHostFtime = this.lib.func(`void GciHostFtime(_Out_ long *sec, _Out_ ushort *millitm)`);
    this._GciHostMilliSleep = this.lib.func(`void GciHostMilliSleep(unsigned int milliSeconds)`);
    this._GciTimeStampMsStr = this.lib.func(`void GciTimeStampMsStr(long seconds, ushort milliSeconds, _Out_ char *result, size_t resultSize)`);
    this._GciTsLogin = this.lib.func(
      `GciSessionPtr GciTsLogin(const char *, const char *, const char *, int, const char *, const char *, const char *, unsigned int, int, _Out_ int *, _Out_ GciErrSType *)`
    );
    this._GciTsLogout = this.lib.func(`int GciTsLogout(GciSessionPtr, _Out_ GciErrSType *)`);
    this._GciTsLogin_ = this.lib.func(
      `GciSessionPtr GciTsLogin_(const char *, const char *, const char *, int, const char *, const char *, const char *, const char *, unsigned int, int, _Out_ int *, _Out_ GciErrSType *)`
    );
    this._GciTsNbLogin = this.lib.func(
      `GciSessionPtr GciTsNbLogin(const char *, const char *, const char *, int, const char *, const char *, const char *, unsigned int, int, _Out_ int *)`
    );
    this._GciTsNbLogin_ = this.lib.func(
      `GciSessionPtr GciTsNbLogin_(const char *, const char *, const char *, int, const char *, const char *, const char *, const char *, unsigned int, int, _Out_ int *)`
    );
    this._GciTsNbLoginFinished = this.lib.func(
      `int GciTsNbLoginFinished(GciSessionPtr, _Out_ int *, _Out_ GciErrSType *)`
    );
    this._GciTsNbLogout = this.lib.func(`int GciTsNbLogout(GciSessionPtr, _Out_ GciErrSType *)`);
    this._GciTsSessionIsRemote = this.lib.func(`int GciTsSessionIsRemote(GciSessionPtr)`);
    this._GciTsEncrypt = this.lib.func(`char* GciTsEncrypt(const char *, _Out_ char *, size_t)`);
    this._GciTsAbort = this.lib.func(`int GciTsAbort(GciSessionPtr, _Out_ GciErrSType *)`);
    this._GciTsBegin = this.lib.func(`int GciTsBegin(GciSessionPtr, _Out_ GciErrSType *)`);
    this._GciTsCommit = this.lib.func(`int GciTsCommit(GciSessionPtr, _Out_ GciErrSType *)`);
    this._GciTsContinueWith = this.lib.func(
      `${OopType} GciTsContinueWith(GciSessionPtr, ${OopType}, ${OopType}, const GciErrSType *, int, _Out_ GciErrSType *)`
    );
    this._GciTsDoubleToOop = this.lib.func(
      `${OopType} GciTsDoubleToOop(GciSessionPtr, double, _Out_ GciErrSType *)`
    );
    this._GciTsOopToDouble = this.lib.func(
      `int GciTsOopToDouble(GciSessionPtr, ${OopType}, _Out_ double *, _Out_ GciErrSType *)`
    );
    this._GciTsI64ToOop = this.lib.func(
      `${OopType} GciTsI64ToOop(GciSessionPtr, int64, _Out_ GciErrSType *)`
    );
    this._GciTsOopToI64 = this.lib.func(
      `int GciTsOopToI64(GciSessionPtr, ${OopType}, _Out_ int64 *, _Out_ GciErrSType *)`
    );
    this._GciTsNewObj = this.lib.func(
      `${OopType} GciTsNewObj(GciSessionPtr, ${OopType}, _Out_ GciErrSType *)`
    );
    this._GciTsNewByteArray = this.lib.func(
      `${OopType} GciTsNewByteArray(GciSessionPtr, const uchar *, size_t, _Out_ GciErrSType *)`
    );
    this._GciTsNewString_ = this.lib.func(
      `${OopType} GciTsNewString_(GciSessionPtr, const char *, size_t, _Out_ GciErrSType *)`
    );
    this._GciTsNewString = this.lib.func(
      `${OopType} GciTsNewString(GciSessionPtr, const char *, _Out_ GciErrSType *)`
    );
    this._GciTsNewSymbol = this.lib.func(
      `${OopType} GciTsNewSymbol(GciSessionPtr, const char *, _Out_ GciErrSType *)`
    );
    this._GciTsNewUnicodeString_ = this.lib.func(
      `${OopType} GciTsNewUnicodeString_(GciSessionPtr, const ushort *, size_t, _Out_ GciErrSType *)`
    );
    this._GciTsNewUnicodeString = this.lib.func(
      `${OopType} GciTsNewUnicodeString(GciSessionPtr, const ushort *, _Out_ GciErrSType *)`
    );
    this._GciTsNewUtf8String = this.lib.func(
      `${OopType} GciTsNewUtf8String(GciSessionPtr, const char *, int, _Out_ GciErrSType *)`
    );
    this._GciTsNewUtf8String_ = this.lib.func(
      `${OopType} GciTsNewUtf8String_(GciSessionPtr, const char *, size_t, int, _Out_ GciErrSType *)`
    );
    this._GciTsFetchUnicode = this.lib.func(
      `int64 GciTsFetchUnicode(GciSessionPtr, ${OopType}, _Out_ ushort *, int64, _Out_ int64 *, _Out_ GciErrSType *)`
    );
    this._GciTsFetchUtf8 = this.lib.func(
      `int64 GciTsFetchUtf8(GciSessionPtr, ${OopType}, _Out_ uchar *, int64, _Out_ int64 *, _Out_ GciErrSType *)`
    );
    this._GciTsFetchObjInfo = this.lib.func(
      `int64 GciTsFetchObjInfo(GciSessionPtr, ${OopType}, int, _Out_ GciTsObjInfo *, _Out_ uchar *, size_t, _Out_ GciErrSType *)`
    );
    this._GciTsFetchSize = this.lib.func(
      `int64 GciTsFetchSize(GciSessionPtr, ${OopType}, _Out_ GciErrSType *)`
    );
    this._GciTsFetchVaryingSize = this.lib.func(
      `int64 GciTsFetchVaryingSize(GciSessionPtr, ${OopType}, _Out_ GciErrSType *)`
    );
    this._GciTsFetchClass = this.lib.func(
      `${OopType} GciTsFetchClass(GciSessionPtr, ${OopType}, _Out_ GciErrSType *)`
    );
    this._GciTsIsKindOf = this.lib.func(
      `int GciTsIsKindOf(GciSessionPtr, ${OopType}, ${OopType}, _Out_ GciErrSType *)`
    );
    this._GciTsIsSubclassOf = this.lib.func(
      `int GciTsIsSubclassOf(GciSessionPtr, ${OopType}, ${OopType}, _Out_ GciErrSType *)`
    );
    this._GciTsIsKindOfClass = this.lib.func(
      `int GciTsIsKindOfClass(GciSessionPtr, ${OopType}, ${OopType}, _Out_ GciErrSType *)`
    );
    this._GciTsIsSubclassOfClass = this.lib.func(
      `int GciTsIsSubclassOfClass(GciSessionPtr, ${OopType}, ${OopType}, _Out_ GciErrSType *)`
    );
    this._GciTsObjExists = this.lib.func(
      `int GciTsObjExists(GciSessionPtr, ${OopType})`
    );
    this._GciTsResolveSymbol = this.lib.func(
      `${OopType} GciTsResolveSymbol(GciSessionPtr, const char *, ${OopType}, _Out_ GciErrSType *)`
    );
    this._GciTsResolveSymbolObj = this.lib.func(
      `${OopType} GciTsResolveSymbolObj(GciSessionPtr, ${OopType}, ${OopType}, _Out_ GciErrSType *)`
    );
    this._GciTsExecute = this.lib.func(
      `${OopType} GciTsExecute(GciSessionPtr, const char *, ${OopType}, ${OopType}, ${OopType}, int, ushort, _Out_ GciErrSType *)`
    );
    this._GciTsExecute_ = this.lib.func(
      `${OopType} GciTsExecute_(GciSessionPtr, const char *, intptr, ${OopType}, ${OopType}, ${OopType}, int, ushort, _Out_ GciErrSType *)`
    );
    this._GciTsExecuteFetchBytes = this.lib.func(
      `intptr GciTsExecuteFetchBytes(GciSessionPtr, const char *, intptr, ${OopType}, ${OopType}, ${OopType}, _Out_ uchar *, intptr, _Out_ GciErrSType *)`
    );
    this._GciTsPerform = this.lib.func(
      `${OopType} GciTsPerform(GciSessionPtr, ${OopType}, ${OopType}, const char *, const ${OopType} *, int, int, ushort, _Out_ GciErrSType *)`
    );
    this._GciTsPerformFetchBytes = this.lib.func(
      `intptr GciTsPerformFetchBytes(GciSessionPtr, ${OopType}, const char *, const ${OopType} *, int, _Out_ uchar *, intptr, _Out_ GciErrSType *)`
    );
    this._GciTsFetchBytes = this.lib.func(
      `int64 GciTsFetchBytes(GciSessionPtr, ${OopType}, int64, _Out_ uchar *, int64, _Out_ GciErrSType *)`
    );
    this._GciTsFetchChars = this.lib.func(
      `int64 GciTsFetchChars(GciSessionPtr, ${OopType}, int64, _Out_ char *, int64, _Out_ GciErrSType *)`
    );
    this._GciTsFetchUtf8Bytes = this.lib.func(
      `int64 GciTsFetchUtf8Bytes(GciSessionPtr, ${OopType}, int64, _Out_ uchar *, int64, _Inout_ ${OopType} *, _Out_ GciErrSType *, int)`
    );
    this._GciTsStoreBytes = this.lib.func(
      `int GciTsStoreBytes(GciSessionPtr, ${OopType}, int64, const uchar *, int64, ${OopType}, _Out_ GciErrSType *)`
    );
    this._GciTsFetchOops = this.lib.func(
      `int GciTsFetchOops(GciSessionPtr, ${OopType}, int64, _Out_ ${OopType} *, int, _Out_ GciErrSType *)`
    );
    this._GciTsFetchNamedOops = this.lib.func(
      `int GciTsFetchNamedOops(GciSessionPtr, ${OopType}, int64, _Out_ ${OopType} *, int, _Out_ GciErrSType *)`
    );
    this._GciTsFetchVaryingOops = this.lib.func(
      `int GciTsFetchVaryingOops(GciSessionPtr, ${OopType}, int64, _Out_ ${OopType} *, int, _Out_ GciErrSType *)`
    );
    this._GciTsStoreOops = this.lib.func(
      `int GciTsStoreOops(GciSessionPtr, ${OopType}, int64, const ${OopType} *, int, _Out_ GciErrSType *, int)`
    );
    this._GciTsStoreNamedOops = this.lib.func(
      `int GciTsStoreNamedOops(GciSessionPtr, ${OopType}, int64, const ${OopType} *, int, _Out_ GciErrSType *, int)`
    );
    this._GciTsStoreIdxOops = this.lib.func(
      `int GciTsStoreIdxOops(GciSessionPtr, ${OopType}, int64, const ${OopType} *, int, _Out_ GciErrSType *)`
    );
    this._GciTsCompileMethod = this.lib.func(
      `${OopType} GciTsCompileMethod(GciSessionPtr, ${OopType}, ${OopType}, ${OopType}, ${OopType}, ${OopType}, int, ushort, _Out_ GciErrSType *)`
    );
    this._GciTsClassRemoveAllMethods = this.lib.func(
      `int GciTsClassRemoveAllMethods(GciSessionPtr, ${OopType}, ushort, _Out_ GciErrSType *)`
    );
    this._GciTsProtectMethods = this.lib.func(
      `int GciTsProtectMethods(GciSessionPtr, int, _Out_ GciErrSType *)`
    );
    this._GciTsBreak = this.lib.func(
      `int GciTsBreak(GciSessionPtr, int, _Out_ GciErrSType *)`
    );
    this._GciTsCallInProgress = this.lib.func(
      `int GciTsCallInProgress(GciSessionPtr, _Out_ GciErrSType *)`
    );
    this._GciTsClearStack = this.lib.func(
      `int GciTsClearStack(GciSessionPtr, ${OopType}, _Out_ GciErrSType *)`
    );
    this._GciTsGemTrace = this.lib.func(
      `int GciTsGemTrace(GciSessionPtr, int, _Out_ GciErrSType *)`
    );
    this._GciTsNbExecute = this.lib.func(
      `int GciTsNbExecute(GciSessionPtr, const char *, ${OopType}, ${OopType}, ${OopType}, int, ushort, _Out_ GciErrSType *)`
    );
    this._GciTsNbPerform = this.lib.func(
      `int GciTsNbPerform(GciSessionPtr, ${OopType}, ${OopType}, const char *, const ${OopType} *, int, int, ushort, _Out_ GciErrSType *)`
    );
    this._GciTsNbResult = this.lib.func(
      `${OopType} GciTsNbResult(GciSessionPtr, _Out_ GciErrSType *)`
    );
    this._GciTsNbPoll = this.lib.func(
      `int GciTsNbPoll(GciSessionPtr, int, _Out_ GciErrSType *)`
    );
    this._GciTsSocket = this.lib.func(
      `int GciTsSocket(GciSessionPtr, _Out_ GciErrSType *)`
    );
    this._GciTsGetFreeOops = this.lib.func(
      `int GciTsGetFreeOops(GciSessionPtr, _Out_ ${OopType} *, int, _Out_ GciErrSType *)`
    );
    this._GciTsSaveObjs = this.lib.func(
      `int GciTsSaveObjs(GciSessionPtr, const ${OopType} *, int, _Out_ GciErrSType *)`
    );
    this._GciTsReleaseObjs = this.lib.func(
      `int GciTsReleaseObjs(GciSessionPtr, const ${OopType} *, int, _Out_ GciErrSType *)`
    );
    this._GciTsReleaseAllObjs = this.lib.func(
      `int GciTsReleaseAllObjs(GciSessionPtr, _Out_ GciErrSType *)`
    );
    this._GciTsAddOopsToNsc = this.lib.func(
      `int GciTsAddOopsToNsc(GciSessionPtr, ${OopType}, const ${OopType} *, int, _Out_ GciErrSType *)`
    );
    this._GciTsRemoveOopsFromNsc = this.lib.func(
      `int GciTsRemoveOopsFromNsc(GciSessionPtr, ${OopType}, const ${OopType} *, int, _Out_ GciErrSType *)`
    );
    this._GciTsPerformFetchOops = this.lib.func(
      `int GciTsPerformFetchOops(GciSessionPtr, ${OopType}, const char *, const ${OopType} *, int, _Out_ ${OopType} *, int, _Out_ GciErrSType *)`
    );
    this._GciTsFetchGbjInfo = this.lib.func(
      `int64 GciTsFetchGbjInfo(GciSessionPtr, ${OopType}, int, _Out_ GciTsGbjInfo *, _Out_ uchar *, size_t, _Out_ GciErrSType *)`
    );
    this._GciTsNewStringFromUtf16 = this.lib.func(
      `${OopType} GciTsNewStringFromUtf16(GciSessionPtr, const ushort *, int64, int, _Out_ GciErrSType *)`
    );
    this._GciTsDirtyObjsInit = this.lib.func(
      `int GciTsDirtyObjsInit(GciSessionPtr, _Out_ GciErrSType *)`
    );
    this._GciTsWaitForEvent = this.lib.func(
      `int GciTsWaitForEvent(GciSessionPtr, int, _Out_ int *, _Out_ GciErrSType *)`
    );
    this._GciTsCancelWaitForEvent = this.lib.func(
      `int GciTsCancelWaitForEvent(GciSessionPtr, _Out_ GciErrSType *)`
    );
    this._GciTsDirtyExportedObjs = this.lib.func(
      `int GciTsDirtyExportedObjs(GciSessionPtr, _Out_ ${OopType} *, _Inout_ int *, _Out_ GciErrSType *)`
    );
    this._GciTsKeepAliveCount = this.lib.func(
      `int64 GciTsKeepAliveCount(GciSessionPtr, _Out_ GciErrSType *)`
    );
    this._GciTsKeyfilePermissions = this.lib.func(
      `int64 GciTsKeyfilePermissions(GciSessionPtr, _Out_ GciErrSType *)`
    );
    this._GciTsDebugConnectToGem = this.lib.func(
      `GciSessionPtr GciTsDebugConnectToGem(int, _Out_ GciErrSType *)`
    );
    this._GciTsDebugStartDebugService = this.lib.func(
      `int GciTsDebugStartDebugService(GciSessionPtr, uint64, _Out_ GciErrSType *)`
    );
    this._GciTsFetchTraversal = this.lib.func(
      `int GciTsFetchTraversal(GciSessionPtr, const ${OopType} *, int, _Inout_ GciClampedTravArgsSType *, _Out_ GciErrSType *)`
    );
    this._GciTsStoreTrav = this.lib.func(
      `int GciTsStoreTrav(GciSessionPtr, void *, int, _Out_ GciErrSType *)`
    );
    this._GciTsMoreTraversal = this.lib.func(
      `int GciTsMoreTraversal(GciSessionPtr, void *, _Out_ GciErrSType *)`
    );
    this._GciTsStoreTravDoTravRefs = this.lib.func(
      `int GciTsStoreTravDoTravRefs(GciSessionPtr, const ${OopType} *, int, const ${OopType} *, int, _Inout_ GciStoreTravDoArgsSType *, _Inout_ GciClampedTravArgsSType *, _Out_ GciErrSType *)`
    );
  }

  GciTsVersion(): { product: number; version: string } {
    const buf = Buffer.alloc(128);
    const product = this._GciTsVersion(buf, buf.length);
    const version = buf.toString('utf8', 0, buf.indexOf(0));
    return { product, version };
  }

  GciTsOopIsSpecial(oop: bigint): boolean {
    return this._GciTsOopIsSpecial(oop) !== 0;
  }

  GciTsFetchSpecialClass(oop: bigint): bigint {
    return toBigInt(this._GciTsFetchSpecialClass(oop));
  }

  GciTsOopToChar(oop: bigint): number {
    return this._GciTsOopToChar(oop);
  }

  GciTsCharToOop(ch: number): bigint {
    return toBigInt(this._GciTsCharToOop(ch));
  }

  GciTsDoubleToSmallDouble(value: number): bigint {
    return toBigInt(this._GciTsDoubleToSmallDouble(value));
  }

  GciI32ToOop(arg: number): bigint {
    return toBigInt(this._GciI32ToOop(arg));
  }

  GciTsI32ToOop(arg: number): bigint {
    return toBigInt(this._GciTsI32ToOop(arg));
  }

  GciUtf8To8bit(src: string): { success: boolean; result: string } {
    const srcBytes = Buffer.byteLength(src, 'utf8');
    const dest = Buffer.alloc(srcBytes + 1);
    const success = this._GciUtf8To8bit(src, dest, dest.length) !== 0;
    const nullPos = dest.indexOf(0);
    const result = dest.toString('latin1', 0, nullPos >= 0 ? nullPos : dest.length);
    return { success, result };
  }

  GciNextUtf8Character(src: string): { bytes: number; codePoint: number } {
    const srcBuf = Buffer.from(src, 'utf8');
    const chOut = Buffer.alloc(4);
    const bytes = this._GciNextUtf8Character(srcBuf, srcBuf.length, chOut);
    return { bytes, codePoint: chOut.readUInt32LE(0) };
  }

  GciShutdown(): void {
    this._GciShutdown();
  }

  GciMalloc(length: number, lineNum: number = 0): unknown {
    return this._GciMalloc(length, lineNum);
  }

  GciFree(ptr: unknown): void {
    this._GciFree(ptr);
  }

  GciHostCallDebuggerMsg(msg: string): number {
    return this._GciHostCallDebuggerMsg(msg);
  }

  GciHostFtime(): { seconds: number; milliSeconds: number } {
    const sec = [0];
    const ms = [0];
    this._GciHostFtime(sec, ms);
    return { seconds: sec[0], milliSeconds: ms[0] };
  }

  GciHostMilliSleep(milliSeconds: number): void {
    this._GciHostMilliSleep(milliSeconds);
  }

  GciTimeStampMsStr(seconds: number, milliSeconds: number): string {
    const buf = Buffer.alloc(64);
    this._GciTimeStampMsStr(seconds, milliSeconds, buf, buf.length);
    const nullPos = buf.indexOf(0);
    return buf.toString('utf8', 0, nullPos >= 0 ? nullPos : buf.length);
  }

  GciTsLogin(
    stoneNrs: string | null,
    hostUserId: string | null,
    hostPassword: string | null,
    hostPwIsEncrypted: boolean,
    gemServiceNrs: string | null,
    gemstoneUsername: string,
    gemstonePassword: string,
    loginFlags: number,
    haltOnErrNum: number,
  ): { session: unknown; executedSessionInit: boolean; err: GciError } {
    const executedSessionInit = [0];
    const err: Record<string, unknown> = {};
    const session = this._GciTsLogin(
      stoneNrs, hostUserId, hostPassword,
      hostPwIsEncrypted ? 1 : 0,
      gemServiceNrs, gemstoneUsername, gemstonePassword,
      loginFlags, haltOnErrNum,
      executedSessionInit, err,
    );
    return {
      session,
      executedSessionInit: executedSessionInit[0] !== 0,
      err: err as unknown as GciError,
    };
  }

  GciTsLogin_(
    stoneNrs: string | null,
    hostUserId: string | null,
    hostPassword: string | null,
    hostPwIsEncrypted: boolean,
    gemServiceNrs: string | null,
    gemstoneUsername: string,
    gemstonePassword: string,
    netldiName: string | null,
    loginFlags: number,
    haltOnErrNum: number,
  ): { session: unknown; executedSessionInit: boolean; err: GciError } {
    const executedSessionInit = [0];
    const err: Record<string, unknown> = {};
    const session = this._GciTsLogin_(
      stoneNrs, hostUserId, hostPassword,
      hostPwIsEncrypted ? 1 : 0,
      gemServiceNrs, gemstoneUsername, gemstonePassword,
      netldiName, loginFlags, haltOnErrNum,
      executedSessionInit, err,
    );
    return {
      session,
      executedSessionInit: executedSessionInit[0] !== 0,
      err: err as unknown as GciError,
    };
  }

  GciTsNbLogin(
    stoneNrs: string | null,
    hostUserId: string | null,
    hostPassword: string | null,
    hostPwIsEncrypted: boolean,
    gemServiceNrs: string | null,
    gemstoneUsername: string,
    gemstonePassword: string,
    loginFlags: number,
    haltOnErrNum: number,
  ): { session: unknown; loginPollSocket: number } {
    const loginPollSocket = [0];
    const session = this._GciTsNbLogin(
      stoneNrs, hostUserId, hostPassword,
      hostPwIsEncrypted ? 1 : 0,
      gemServiceNrs, gemstoneUsername, gemstonePassword,
      loginFlags, haltOnErrNum,
      loginPollSocket,
    );
    return { session, loginPollSocket: loginPollSocket[0] };
  }

  GciTsNbLogin_(
    stoneNrs: string | null,
    hostUserId: string | null,
    hostPassword: string | null,
    hostPwIsEncrypted: boolean,
    gemServiceNrs: string | null,
    gemstoneUsername: string,
    gemstonePassword: string,
    netldiName: string | null,
    loginFlags: number,
    haltOnErrNum: number,
  ): { session: unknown; loginPollSocket: number } {
    const loginPollSocket = [0];
    const session = this._GciTsNbLogin_(
      stoneNrs, hostUserId, hostPassword,
      hostPwIsEncrypted ? 1 : 0,
      gemServiceNrs, gemstoneUsername, gemstonePassword,
      netldiName, loginFlags, haltOnErrNum,
      loginPollSocket,
    );
    return { session, loginPollSocket: loginPollSocket[0] };
  }

  GciTsNbLoginFinished(session: unknown): { result: number; executedSessionInit: boolean; err: GciError } {
    const executedSessionInit = [0];
    const err: Record<string, unknown> = {};
    const result = this._GciTsNbLoginFinished(session, executedSessionInit, err);
    return {
      result,
      executedSessionInit: executedSessionInit[0] !== 0,
      err: err as unknown as GciError,
    };
  }

  GciTsLogout(session: unknown): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsLogout(session, err);
    return {
      success: result !== 0,
      err: err as unknown as GciError,
    };
  }

  GciTsEncrypt(password: string): string | null {
    const outBuf = Buffer.alloc(1024);
    const result = this._GciTsEncrypt(password, outBuf, outBuf.length);
    if (result === null) {
      return null;
    }
    const nullPos = outBuf.indexOf(0);
    return outBuf.toString('utf8', 0, nullPos >= 0 ? nullPos : outBuf.length);
  }

  GciTsSessionIsRemote(session: unknown): number {
    return this._GciTsSessionIsRemote(session);
  }

  GciTsNbLogout(session: unknown): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsNbLogout(session, err);
    return {
      success: result !== 0,
      err: err as unknown as GciError,
    };
  }

  GciTsAbort(session: unknown): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsAbort(session, err);
    return {
      success: result !== 0,
      err: err as unknown as GciError,
    };
  }

  GciTsBegin(session: unknown): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsBegin(session, err);
    return {
      success: result !== 0,
      err: err as unknown as GciError,
    };
  }

  GciTsCommit(session: unknown): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsCommit(session, err);
    return {
      success: result !== 0,
      err: err as unknown as GciError,
    };
  }

  GciTsContinueWith(
    session: unknown,
    gsProcess: bigint,
    replaceTopOfStack: bigint,
    continueWithError: GciError | null,
    flags: number,
  ): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsContinueWith(
      session, gsProcess, replaceTopOfStack,
      continueWithError, flags, err,
    );
    return {
      result: toBigInt(raw),
      err: err as unknown as GciError,
    };
  }

  GciTsDoubleToOop(session: unknown, aDouble: number): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsDoubleToOop(session, aDouble, err);
    return {
      result: toBigInt(raw),
      err: err as unknown as GciError,
    };
  }

  GciTsOopToDouble(session: unknown, oop: bigint): { success: boolean; value: number; err: GciError } {
    const result = [0.0];
    const err: Record<string, unknown> = {};
    const success = this._GciTsOopToDouble(session, oop, result, err);
    return {
      success: success !== 0,
      value: result[0],
      err: err as unknown as GciError,
    };
  }

  GciTsI64ToOop(session: unknown, arg: bigint): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsI64ToOop(session, arg, err);
    return {
      result: toBigInt(raw),
      err: err as unknown as GciError,
    };
  }

  GciTsOopToI64(session: unknown, oop: bigint): { success: boolean; value: bigint; err: GciError } {
    const result = [0n];
    const err: Record<string, unknown> = {};
    const success = this._GciTsOopToI64(session, oop, result, err);
    return {
      success: success !== 0,
      value: toBigInt(result[0]),
      err: err as unknown as GciError,
    };
  }

  GciTsNewObj(session: unknown, aClass: bigint): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsNewObj(session, aClass, err);
    return { result: toBigInt(raw), err: err as unknown as GciError };
  }

  GciTsNewByteArray(session: unknown, body: Buffer): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsNewByteArray(session, body, body.length, err);
    return { result: toBigInt(raw), err: err as unknown as GciError };
  }

  GciTsNewString_(session: unknown, cString: string, nBytes: number): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsNewString_(session, cString, nBytes, err);
    return { result: toBigInt(raw), err: err as unknown as GciError };
  }

  GciTsNewString(session: unknown, cString: string): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsNewString(session, cString, err);
    return { result: toBigInt(raw), err: err as unknown as GciError };
  }

  GciTsNewSymbol(session: unknown, cString: string): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsNewSymbol(session, cString, err);
    return { result: toBigInt(raw), err: err as unknown as GciError };
  }

  GciTsNewUnicodeString_(session: unknown, str: Buffer, numShorts: number): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsNewUnicodeString_(session, str, numShorts, err);
    return { result: toBigInt(raw), err: err as unknown as GciError };
  }

  GciTsNewUnicodeString(session: unknown, str: Buffer): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsNewUnicodeString(session, str, err);
    return { result: toBigInt(raw), err: err as unknown as GciError };
  }

  GciTsNewUtf8String(session: unknown, utf8data: string, convertToUnicode: boolean): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsNewUtf8String(session, utf8data, convertToUnicode ? 1 : 0, err);
    return { result: toBigInt(raw), err: err as unknown as GciError };
  }

  GciTsNewUtf8String_(session: unknown, utf8data: string, nBytes: number, convertToUnicode: boolean): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsNewUtf8String_(session, utf8data, nBytes, convertToUnicode ? 1 : 0, err);
    return { result: toBigInt(raw), err: err as unknown as GciError };
  }

  GciTsFetchUnicode(session: unknown, obj: bigint, destShorts: number): { bytesReturned: bigint; requiredSize: bigint; data: Buffer; err: GciError } {
    const dest = Buffer.alloc(destShorts * 2);
    const requiredSize = [0n];
    const err: Record<string, unknown> = {};
    const bytesReturned = this._GciTsFetchUnicode(session, obj, dest, destShorts, requiredSize, err);
    return {
      bytesReturned: toBigInt(bytesReturned),
      requiredSize: toBigInt(requiredSize[0]),
      data: dest,
      err: err as unknown as GciError,
    };
  }

  GciTsFetchUtf8(session: unknown, obj: bigint, destSize: number): { bytesReturned: bigint; requiredSize: bigint; data: string; err: GciError } {
    const dest = Buffer.alloc(destSize);
    const requiredSize = [0n];
    const err: Record<string, unknown> = {};
    const bytesReturned = this._GciTsFetchUtf8(session, obj, dest, destSize, requiredSize, err);
    const br = toBigInt(bytesReturned);
    const str = br >= 0n ? dest.toString('utf8', 0, Number(br)) : '';
    return {
      bytesReturned: br,
      requiredSize: toBigInt(requiredSize[0]),
      data: str,
      err: err as unknown as GciError,
    };
  }

  GciTsFetchObjInfo(session: unknown, objId: bigint, addToExportSet: boolean, bufSize: number): { result: bigint; info: GciObjInfo; buffer: Buffer; err: GciError } {
    const info: Record<string, unknown> = {};
    const buffer = Buffer.alloc(bufSize);
    const err: Record<string, unknown> = {};
    const result = this._GciTsFetchObjInfo(session, objId, addToExportSet ? 1 : 0, info, buffer, bufSize, err);
    // Normalize OopType fields from Number to BigInt
    if (info.objId !== undefined) info.objId = toBigInt(info.objId as number | bigint);
    if (info.objClass !== undefined) info.objClass = toBigInt(info.objClass as number | bigint);
    if (info.objSize !== undefined) info.objSize = toBigInt(info.objSize as number | bigint);
    return {
      result: toBigInt(result),
      info: info as unknown as GciObjInfo,
      buffer,
      err: err as unknown as GciError,
    };
  }

  GciTsFetchSize(session: unknown, obj: bigint): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsFetchSize(session, obj, err);
    return { result: toBigInt(raw), err: err as unknown as GciError };
  }

  GciTsFetchVaryingSize(session: unknown, obj: bigint): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsFetchVaryingSize(session, obj, err);
    return { result: toBigInt(raw), err: err as unknown as GciError };
  }

  GciTsFetchClass(session: unknown, obj: bigint): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsFetchClass(session, obj, err);
    return { result: toBigInt(raw), err: err as unknown as GciError };
  }

  GciTsIsKindOf(session: unknown, obj: bigint, aClass: bigint): { result: number; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsIsKindOf(session, obj, aClass, err);
    return { result, err: err as unknown as GciError };
  }

  GciTsIsSubclassOf(session: unknown, cls: bigint, aClass: bigint): { result: number; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsIsSubclassOf(session, cls, aClass, err);
    return { result, err: err as unknown as GciError };
  }

  GciTsIsKindOfClass(session: unknown, obj: bigint, aClass: bigint): { result: number; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsIsKindOfClass(session, obj, aClass, err);
    return { result, err: err as unknown as GciError };
  }

  GciTsIsSubclassOfClass(session: unknown, cls: bigint, aClass: bigint): { result: number; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsIsSubclassOfClass(session, cls, aClass, err);
    return { result, err: err as unknown as GciError };
  }

  GciTsObjExists(session: unknown, obj: bigint): boolean {
    return this._GciTsObjExists(session, obj) !== 0;
  }

  GciTsResolveSymbol(session: unknown, str: string, symbolList: bigint): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsResolveSymbol(session, str, symbolList, err);
    return { result: toBigInt(raw), err: err as unknown as GciError };
  }

  GciTsResolveSymbolObj(session: unknown, str: bigint, symbolList: bigint): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsResolveSymbolObj(session, str, symbolList, err);
    return { result: toBigInt(raw), err: err as unknown as GciError };
  }

  GciTsExecute(
    session: unknown,
    sourceStr: string | null,
    sourceOop: bigint,
    contextObject: bigint,
    symbolList: bigint,
    flags: number,
    environmentId: number,
  ): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsExecute(
      session, sourceStr, sourceOop, contextObject, symbolList,
      flags, environmentId, err,
    );
    return { result: toBigInt(raw), err: err as unknown as GciError };
  }

  GciTsExecute_(
    session: unknown,
    sourceStr: string | null,
    sourceSize: number,
    sourceOop: bigint,
    contextObject: bigint,
    symbolList: bigint,
    flags: number,
    environmentId: number,
  ): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    // The -1 sentinel (use strlen) doesn't work over RPC; compute actual byte length
    const actualSize = sourceSize === -1 && sourceStr !== null
      ? Buffer.byteLength(sourceStr, 'utf8')
      : sourceSize;
    const raw = this._GciTsExecute_(
      session, sourceStr, actualSize, sourceOop, contextObject, symbolList,
      flags, environmentId, err,
    );
    return { result: toBigInt(raw), err: err as unknown as GciError };
  }

  GciTsExecuteFetchBytes(
    session: unknown,
    sourceStr: string | null,
    sourceSize: number,
    sourceOop: bigint,
    contextObject: bigint,
    symbolList: bigint,
    maxResultSize: number,
  ): { bytesReturned: number; data: string; err: GciError } {
    const result = Buffer.alloc(maxResultSize);
    const err: Record<string, unknown> = {};
    // The -1 sentinel (use strlen) doesn't work over RPC; compute actual byte length
    const actualSize = sourceSize === -1 && sourceStr !== null
      ? Buffer.byteLength(sourceStr, 'utf8')
      : sourceSize;
    const bytesReturned = this._GciTsExecuteFetchBytes(
      session, sourceStr, actualSize, sourceOop, contextObject, symbolList,
      result, maxResultSize, err,
    );
    const str = bytesReturned >= 0 ? result.toString('utf8', 0, bytesReturned) : '';
    return { bytesReturned, data: str, err: err as unknown as GciError };
  }

  GciTsPerform(
    session: unknown,
    receiver: bigint,
    selector: bigint,
    selectorStr: string | null,
    args: bigint[],
    flags: number,
    environmentId: number,
  ): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsPerform(
      session, receiver, selector, selectorStr,
      args.length > 0 ? args : null, args.length,
      flags, environmentId, err,
    );
    return { result: toBigInt(raw), err: err as unknown as GciError };
  }

  GciTsPerformFetchBytes(
    session: unknown,
    receiver: bigint,
    selectorStr: string,
    args: bigint[],
    maxResultSize: number,
  ): { bytesReturned: number; data: string; err: GciError } {
    const result = Buffer.alloc(maxResultSize);
    const err: Record<string, unknown> = {};
    const bytesReturned = this._GciTsPerformFetchBytes(
      session, receiver, selectorStr,
      args.length > 0 ? args : null, args.length,
      result, maxResultSize, err,
    );
    const str = bytesReturned >= 0 ? result.toString('utf8', 0, bytesReturned) : '';
    return { bytesReturned, data: str, err: err as unknown as GciError };
  }

  GciTsFetchBytes(
    session: unknown,
    theObject: bigint,
    startIndex: bigint,
    numBytes: number,
  ): { bytesReturned: bigint; data: Buffer; err: GciError } {
    const dest = Buffer.alloc(numBytes);
    const err: Record<string, unknown> = {};
    const raw = this._GciTsFetchBytes(session, theObject, startIndex, dest, numBytes, err);
    const bytesReturned = toBigInt(raw);
    return { bytesReturned, data: dest, err: err as unknown as GciError };
  }

  GciTsFetchChars(
    session: unknown,
    theObject: bigint,
    startIndex: bigint,
    maxSize: number,
  ): { bytesReturned: bigint; data: string; err: GciError } {
    const buf = Buffer.alloc(maxSize);
    const err: Record<string, unknown> = {};
    const raw = this._GciTsFetchChars(session, theObject, startIndex, buf, maxSize, err);
    const bytesReturned = toBigInt(raw);
    const str = bytesReturned >= 0n ? buf.toString('utf8', 0, Number(bytesReturned)) : '';
    return { bytesReturned, data: str, err: err as unknown as GciError };
  }

  GciTsFetchUtf8Bytes(
    session: unknown,
    aString: bigint,
    startIndex: bigint,
    bufSize: number,
    flags: number = 0,
  ): { bytesReturned: bigint; utf8String: bigint; data: Buffer; err: GciError } {
    const dest = Buffer.alloc(bufSize);
    const utf8StringArr = [aString];
    const err: Record<string, unknown> = {};
    const raw = this._GciTsFetchUtf8Bytes(
      session, aString, startIndex, dest, bufSize,
      utf8StringArr, err, flags,
    );
    const bytesReturned = toBigInt(raw);
    return {
      bytesReturned,
      utf8String: toBigInt(utf8StringArr[0]),
      data: dest,
      err: err as unknown as GciError,
    };
  }

  GciTsStoreBytes(
    session: unknown,
    theObject: bigint,
    startIndex: bigint,
    theBytes: Buffer,
    ofClass: bigint,
  ): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsStoreBytes(
      session, theObject, startIndex, theBytes, theBytes.length, ofClass, err,
    );
    return { success: result !== 0, err: err as unknown as GciError };
  }

  GciTsFetchOops(
    session: unknown,
    theObject: bigint,
    startIndex: bigint,
    numOops: number,
  ): { result: number; oops: bigint[]; err: GciError } {
    const oopsBuf = new Array<bigint>(numOops).fill(0n);
    const err: Record<string, unknown> = {};
    const result = this._GciTsFetchOops(session, theObject, startIndex, oopsBuf, numOops, err);
    const oops = result >= 0 ? oopsBuf.slice(0, result).map(v => toBigInt(v)) : [];
    return { result, oops, err: err as unknown as GciError };
  }

  GciTsFetchNamedOops(
    session: unknown,
    theObject: bigint,
    startIndex: bigint,
    numOops: number,
  ): { result: number; oops: bigint[]; err: GciError } {
    const oopsBuf = new Array<bigint>(numOops).fill(0n);
    const err: Record<string, unknown> = {};
    const result = this._GciTsFetchNamedOops(session, theObject, startIndex, oopsBuf, numOops, err);
    const oops = result >= 0 ? oopsBuf.slice(0, result).map(v => toBigInt(v)) : [];
    return { result, oops, err: err as unknown as GciError };
  }

  GciTsFetchVaryingOops(
    session: unknown,
    theObject: bigint,
    startIndex: bigint,
    numOops: number,
  ): { result: number; oops: bigint[]; err: GciError } {
    const oopsBuf = new Array<bigint>(numOops).fill(0n);
    const err: Record<string, unknown> = {};
    const result = this._GciTsFetchVaryingOops(session, theObject, startIndex, oopsBuf, numOops, err);
    const oops = result >= 0 ? oopsBuf.slice(0, result).map(v => toBigInt(v)) : [];
    return { result, oops, err: err as unknown as GciError };
  }

  GciTsStoreOops(
    session: unknown,
    theObject: bigint,
    startIndex: bigint,
    theOops: bigint[],
    overlay: boolean = false,
  ): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsStoreOops(
      session, theObject, startIndex, theOops, theOops.length,
      err, overlay ? 1 : 0,
    );
    return { success: result !== 0, err: err as unknown as GciError };
  }

  GciTsStoreNamedOops(
    session: unknown,
    theObject: bigint,
    startIndex: bigint,
    theOops: bigint[],
    overlay: boolean = false,
  ): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsStoreNamedOops(
      session, theObject, startIndex, theOops, theOops.length,
      err, overlay ? 1 : 0,
    );
    return { success: result !== 0, err: err as unknown as GciError };
  }

  GciTsStoreIdxOops(
    session: unknown,
    theObject: bigint,
    startIndex: bigint,
    theOops: bigint[],
  ): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsStoreIdxOops(
      session, theObject, startIndex, theOops, theOops.length, err,
    );
    return { success: result !== 0, err: err as unknown as GciError };
  }

  GciTsCompileMethod(
    session: unknown,
    source: bigint,
    aClass: bigint,
    category: bigint,
    symbolList: bigint,
    overrideSelector: bigint,
    compileFlags: number,
    environmentId: number,
  ): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsCompileMethod(
      session, source, aClass, category, symbolList,
      overrideSelector, compileFlags, environmentId, err,
    );
    return { result: toBigInt(raw), err: err as unknown as GciError };
  }

  GciTsClassRemoveAllMethods(
    session: unknown,
    aClass: bigint,
    environmentId: number,
  ): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsClassRemoveAllMethods(
      session, aClass, environmentId, err,
    );
    return { success: result !== 0, err: err as unknown as GciError };
  }

  GciTsProtectMethods(
    session: unknown,
    mode: boolean,
  ): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsProtectMethods(session, mode ? 1 : 0, err);
    return { success: result !== 0, err: err as unknown as GciError };
  }

  GciTsBreak(
    session: unknown,
    hard: boolean,
  ): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsBreak(session, hard ? 1 : 0, err);
    return { success: result !== 0, err: err as unknown as GciError };
  }

  GciTsCallInProgress(
    session: unknown,
  ): { result: number; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsCallInProgress(session, err);
    return { result, err: err as unknown as GciError };
  }

  GciTsClearStack(
    session: unknown,
    gsProcess: bigint,
  ): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsClearStack(session, gsProcess, err);
    return { success: result !== 0, err: err as unknown as GciError };
  }

  GciTsGemTrace(
    session: unknown,
    enable: number,
  ): { previousLevel: number; err: GciError } {
    const err: Record<string, unknown> = {};
    const previousLevel = this._GciTsGemTrace(session, enable, err);
    return { previousLevel, err: err as unknown as GciError };
  }

  GciTsNbExecute(
    session: unknown,
    sourceStr: string | null,
    sourceOop: bigint,
    contextObject: bigint,
    symbolList: bigint,
    flags: number,
    environmentId: number,
  ): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsNbExecute(
      session, sourceStr, sourceOop, contextObject, symbolList,
      flags, environmentId, err,
    );
    return { success: result !== 0, err: err as unknown as GciError };
  }

  GciTsNbPerform(
    session: unknown,
    receiver: bigint,
    selector: bigint,
    selectorStr: string | null,
    args: bigint[],
    flags: number,
    environmentId: number,
  ): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsNbPerform(
      session, receiver, selector, selectorStr,
      args.length > 0 ? args : null, args.length,
      flags, environmentId, err,
    );
    return { success: result !== 0, err: err as unknown as GciError };
  }

  GciTsNbResult(
    session: unknown,
  ): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsNbResult(session, err);
    return { result: toBigInt(raw), err: err as unknown as GciError };
  }

  GciTsNbPoll(
    session: unknown,
    timeoutMs: number,
  ): { result: number; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsNbPoll(session, timeoutMs, err);
    return { result, err: err as unknown as GciError };
  }

  GciTsSocket(
    session: unknown,
  ): { fd: number; err: GciError } {
    const err: Record<string, unknown> = {};
    const fd = this._GciTsSocket(session, err);
    return { fd, err: err as unknown as GciError };
  }

  GciTsGetFreeOops(
    session: unknown,
    numOopsRequested: number,
  ): { result: number; oops: bigint[]; err: GciError } {
    const buf = new Array<bigint>(numOopsRequested).fill(0n);
    const err: Record<string, unknown> = {};
    const result = this._GciTsGetFreeOops(session, buf, numOopsRequested, err);
    const oops = result > 0 ? buf.slice(0, result).map(v => toBigInt(v)) : [];
    return { result, oops, err: err as unknown as GciError };
  }

  GciTsSaveObjs(
    session: unknown,
    oops: bigint[],
  ): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsSaveObjs(session, oops, oops.length, err);
    return { success: result !== 0, err: err as unknown as GciError };
  }

  GciTsReleaseObjs(
    session: unknown,
    oops: bigint[],
  ): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsReleaseObjs(session, oops, oops.length, err);
    return { success: result !== 0, err: err as unknown as GciError };
  }

  GciTsReleaseAllObjs(
    session: unknown,
  ): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsReleaseAllObjs(session, err);
    return { success: result !== 0, err: err as unknown as GciError };
  }

  GciTsAddOopsToNsc(
    session: unknown,
    theObject: bigint,
    theOops: bigint[],
  ): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsAddOopsToNsc(
      session, theObject, theOops, theOops.length, err,
    );
    return { success: result !== 0, err: err as unknown as GciError };
  }

  GciTsRemoveOopsFromNsc(
    session: unknown,
    theNsc: bigint,
    theOops: bigint[],
  ): { result: number; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsRemoveOopsFromNsc(
      session, theNsc, theOops, theOops.length, err,
    );
    return { result, err: err as unknown as GciError };
  }

  GciTsPerformFetchOops(
    session: unknown,
    receiver: bigint,
    selectorStr: string,
    args: bigint[],
    maxResultSize: number,
  ): { result: number; oops: bigint[]; err: GciError } {
    const buf = new Array<bigint>(maxResultSize).fill(0n);
    const err: Record<string, unknown> = {};
    const result = this._GciTsPerformFetchOops(
      session, receiver, selectorStr,
      args.length > 0 ? args : null, args.length,
      buf, maxResultSize, err,
    );
    const oops = result > 0 ? buf.slice(0, result).map(v => toBigInt(v)) : [];
    return { result, oops, err: err as unknown as GciError };
  }

  GciTsFetchGbjInfo(
    session: unknown,
    objId: bigint,
    addToExportSet: boolean,
    bufSize: number,
  ): { result: bigint; info: GciGbjInfo; data: Buffer; err: GciError } {
    const info: Record<string, unknown> = {};
    const buffer = Buffer.alloc(bufSize);
    const err: Record<string, unknown> = {};
    const raw = this._GciTsFetchGbjInfo(
      session, objId, addToExportSet ? 1 : 0, info, buffer, bufSize, err,
    );
    // Normalize OopType and int64 fields from Number to BigInt
    if (info.objId !== undefined) info.objId = toBigInt(info.objId as number | bigint);
    if (info.objClass !== undefined) info.objClass = toBigInt(info.objClass as number | bigint);
    if (info.objSize !== undefined) info.objSize = toBigInt(info.objSize as number | bigint);
    if (info.extraBits !== undefined) info.extraBits = toBigInt(info.extraBits as number | bigint);
    if (info.bytesReturned !== undefined) info.bytesReturned = toBigInt(info.bytesReturned as number | bigint);
    return {
      result: toBigInt(raw),
      info: info as unknown as GciGbjInfo,
      data: buffer,
      err: err as unknown as GciError,
    };
  }

  GciTsNewStringFromUtf16(
    session: unknown,
    words: number[],
    unicodeKind: number,
  ): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsNewStringFromUtf16(
      session, words, BigInt(words.length), unicodeKind, err,
    );
    return { result: toBigInt(raw), err: err as unknown as GciError };
  }

  GciTsDirtyObjsInit(
    session: unknown,
  ): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsDirtyObjsInit(session, err);
    return { success: result !== 0, err: err as unknown as GciError };
  }

  static createTravBuf(bodySize: number = 65536): Buffer {
    const buf = Buffer.alloc(8 + bodySize);
    buf.writeUInt32LE(bodySize, 0); // allocatedBytes
    buf.writeUInt32LE(0, 4);        // usedBytes
    return buf;
  }

  static parseTravBuffer(travBuf: Buffer): GciObjReport[] {
    const usedBytes = travBuf.readUInt32LE(4);
    const reports: GciObjReport[] = [];
    let offset = 8; // skip allocatedBytes + usedBytes header
    const limit = 8 + usedBytes;
    while (offset + OBJ_REP_HDR_SIZE <= limit) {
      const valueBuffSize = travBuf.readInt32LE(offset);
      const namedSize = travBuf.readInt16LE(offset + 4);
      const objectSecurityPolicyId = travBuf.readUInt16LE(offset + 6);
      const objId = travBuf.readBigUInt64LE(offset + 8);
      const oclass = travBuf.readBigUInt64LE(offset + 16);
      const firstOffset = travBuf.readBigInt64LE(offset + 24);
      const idxSizeBits = travBuf.readBigUInt64LE(offset + 32);
      const bodyStart = offset + OBJ_REP_HDR_SIZE;
      const bodyEnd = Math.min(bodyStart + valueBuffSize, limit);
      const body = Buffer.from(travBuf.subarray(bodyStart, bodyEnd));

      reports.push({
        objId, oclass, firstOffset, namedSize, objectSecurityPolicyId,
        valueBuffSize, idxSizeBits, body,
      });

      // Next report: header + pad8(valueBuffSize)
      offset += OBJ_REP_HDR_SIZE + ((valueBuffSize + 7) & ~7);
    }
    return reports;
  }

  static buildTravBuffer(reports: {
    objId: bigint; oclass: bigint; firstOffset: bigint;
    body: Buffer | Uint8Array;
    namedSize?: number; objectSecurityPolicyId?: number;
    idxSizeBits?: bigint;
  }[]): Buffer {
    let totalBodySize = 0;
    for (const r of reports) {
      totalBodySize += OBJ_REP_HDR_SIZE + ((r.body.length + 7) & ~7);
    }
    const buf = Buffer.alloc(8 + totalBodySize);
    buf.writeUInt32LE(totalBodySize, 0); // allocatedBytes
    buf.writeUInt32LE(totalBodySize, 4); // usedBytes

    let offset = 8;
    for (const r of reports) {
      buf.writeInt32LE(r.body.length, offset);                     // valueBuffSize
      buf.writeInt16LE(r.namedSize ?? 0, offset + 4);              // namedSize
      buf.writeUInt16LE(r.objectSecurityPolicyId ?? 0, offset + 6); // objectSecurityPolicyId
      buf.writeBigUInt64LE(r.objId, offset + 8);                   // objId
      buf.writeBigUInt64LE(r.oclass, offset + 16);                 // oclass
      buf.writeBigInt64LE(r.firstOffset, offset + 24);             // firstOffset
      buf.writeBigUInt64LE(r.idxSizeBits ?? 0n, offset + 32);     // _idxSizeBits
      Buffer.from(r.body).copy(buf, offset + OBJ_REP_HDR_SIZE);
      offset += OBJ_REP_HDR_SIZE + ((r.body.length + 7) & ~7);
    }
    return buf;
  }

  GciTsFetchTraversal(
    session: unknown,
    oops: bigint[],
    level: number = 1,
    retrievalFlags: number = 0,
    clampSpec: bigint = 0x14n,
    bufSize: number = 65536,
  ): { status: number; resultOop: bigint; travBuf: Buffer; err: GciError } {
    const travBuf = GciLibrary.createTravBuf(bufSize);
    const ctArgs: Record<string, unknown> = {
      clampSpec,
      resultOop: 0x14n,
      travBuff: travBuf,
      level,
      retrievalFlags,
      isRpc: 1,
    };
    const err: Record<string, unknown> = {};
    const status = this._GciTsFetchTraversal(
      session, oops.length > 0 ? oops : null, oops.length, ctArgs, err,
    );
    return {
      status,
      resultOop: toBigInt(ctArgs.resultOop as number | bigint),
      travBuf,
      err: err as unknown as GciError,
    };
  }

  GciTsMoreTraversal(
    session: unknown,
    bufSize: number = 65536,
  ): { status: number; travBuf: Buffer; err: GciError } {
    const travBuf = GciLibrary.createTravBuf(bufSize);
    const err: Record<string, unknown> = {};
    const status = this._GciTsMoreTraversal(session, travBuf, err);
    return { status, travBuf, err: err as unknown as GciError };
  }

  GciTsStoreTrav(
    session: unknown,
    travBuf: Buffer,
    flag: number = 0,
  ): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsStoreTrav(session, travBuf, flag, err);
    return { success: result !== 0, err: err as unknown as GciError };
  }

  GciTsStoreTravDoTravRefs(
    session: unknown,
    oopsNoLongerReplicated: bigint[] | null,
    oopsGcedOnClient: bigint[] | null,
    stdArgs: Record<string, unknown>,
    level: number = 1,
    retrievalFlags: number = 0,
    clampSpec: bigint = 0x14n,
    bufSize: number = 65536,
  ): { status: number; resultOop: bigint; travBuf: Buffer; stdArgs: Record<string, unknown>; err: GciError } {
    const travBuf = GciLibrary.createTravBuf(bufSize);
    const ctArgs: Record<string, unknown> = {
      clampSpec,
      resultOop: 0x14n,
      travBuff: travBuf,
      level,
      retrievalFlags,
      isRpc: 1,
    };
    const err: Record<string, unknown> = {};
    const status = this._GciTsStoreTravDoTravRefs(
      session,
      oopsNoLongerReplicated, oopsNoLongerReplicated?.length ?? 0,
      oopsGcedOnClient, oopsGcedOnClient?.length ?? 0,
      stdArgs, ctArgs, err,
    );
    return {
      status,
      resultOop: toBigInt(ctArgs.resultOop as number | bigint),
      travBuf,
      stdArgs,
      err: err as unknown as GciError,
    };
  }

  GciTsWaitForEvent(
    session: unknown,
    latencyMs: number,
  ): { result: number; event: number; err: GciError } {
    const evOut = [0];
    const err: Record<string, unknown> = {};
    const result = this._GciTsWaitForEvent(session, latencyMs, evOut, err);
    return { result, event: evOut[0], err: err as unknown as GciError };
  }

  GciTsCancelWaitForEvent(
    session: unknown,
  ): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsCancelWaitForEvent(session, err);
    return { success: result !== 0, err: err as unknown as GciError };
  }

  GciTsDirtyExportedObjs(
    session: unknown,
    maxOops: number,
  ): { success: boolean; oops: bigint[]; err: GciError } {
    const buf = new Array<bigint>(maxOops).fill(0n);
    const numOops = [maxOops];
    const err: Record<string, unknown> = {};
    const result = this._GciTsDirtyExportedObjs(session, buf, numOops, err);
    const oops = numOops[0] > 0 ? buf.slice(0, numOops[0]).map(v => toBigInt(v)) : [];
    return { success: result !== 0, oops, err: err as unknown as GciError };
  }

  GciTsKeepAliveCount(
    session: unknown,
  ): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsKeepAliveCount(session, err);
    return { result: toBigInt(raw), err: err as unknown as GciError };
  }

  GciTsKeyfilePermissions(
    session: unknown,
  ): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsKeyfilePermissions(session, err);
    return { result: toBigInt(raw), err: err as unknown as GciError };
  }

  GciTsDebugConnectToGem(
    gemPid: number,
  ): { session: unknown; err: GciError } {
    const err: Record<string, unknown> = {};
    const session = this._GciTsDebugConnectToGem(gemPid, err);
    return { session, err: err as unknown as GciError };
  }

  GciTsDebugStartDebugService(
    session: unknown,
    token: bigint,
  ): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsDebugStartDebugService(session, token, err);
    return { success: result !== 0, err: err as unknown as GciError };
  }

  close(): void {
    this.lib.unload();
  }
}
