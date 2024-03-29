/*
 *	JadeServer.ts
 *
 *  This file is structured for easy viewing and editing and uses functions
 *  so we can 'fold' the contents and use the 'outline' for quick lookup
 */

const getClassesInDictionary = (): string => {
	return `getClassesInDictionary: aSymbolDictionary chunk: anInteger
| comma stream string |
stream := WriteStream on: String new.
stream nextPutAll: '{"list":['.
comma := ''.
aSymbolDictionary values collect: [ :each |
	(each class asString endsWith: ' class') ifTrue: [
		stream
			nextPutAll: comma;
			nextPutAll: '{"oop":';
			print: each asOop;
			nextPutAll: ',"name":"';
			nextPutAll: each name;
			nextPutAll: '.tpz","size":0,"md5":""}';
			yourself.
		comma := ','.
	]
].
stream nextPutAll: ']}'.
string := stream contents.
^string copyFrom: anInteger - 1 * 25000 + 1 to: (anInteger * 25000 min: string size)`;
};
const getSymbolList = (): string => {
	return `getSymbolList
| comma stream |
stream := WriteStream on: String new.
stream nextPutAll: '{"list":['.
comma := ''.
System myUserProfile symbolList do: [:each |
stream
    nextPutAll: comma;
    nextPutAll: '{"oop":';
    print: each asOop;
    nextPutAll: ',"name":"';
    nextPutAll: each name;
    nextPutAll: '","size":';
    print: (each select: [:each | each isClass]) size;
    nextPutAll: '}';
    yourself.
comma := ','.
].
stream nextPutAll: ']}'.
^stream contents.`;
};
const fileOutClass = (): string => {
	return `fileOutClass: aClass chunk: anInteger
	| string |
	
	string := aClass fileOutClass.
	^string copyFrom: anInteger - 1 * 25000 + 1 to: (anInteger * 25000 min: string size)`;
};

// list the methods
const methods = [
	fileOutClass(),
	getClassesInDictionary(),
	getSymbolList(),
];

// this puts it all together
const getCode = (): string => {
	let code = `
| class result server source symbolList |
symbolList := (AllUsers userWithId: 'DataCurator') symbolList.
symbolList := symbolList class new
    add: (symbolList detect: [:each | each name == #UserGlobals]);
    add: (symbolList detect: [:each | each name == #Globals]);
    yourself.
[
    class := symbolList objectNamed: #Object.
    class := class subclass: 'JadeServer'
		instVarNames: #()
		classVars: #()
		classInstVars: #()
		poolDictionaries: (#() class withAll: symbolList)
        inDictionary: SymbolDictionary new.
`;
	methods.forEach(element => {
		code = code + `source := '` + element.replace(new RegExp(`'`, 'g'), `''`) + `'.
	result := class
	compileMethod: source
	dictionaries: symbolList
	category: 'category'.
	result ~~ nil ifTrue: [^GsNMethod _sourceWithErrors: result fromString: source].
`;
	});
	code = code + `
    class new "initialize"
] on: (symbolList objectNamed: #Error) do: [:ex |
    ex return: 'ERROR: ' , (GsProcess stackReportToLevel: 100)
]`;
	return code;
};

// the result is simply a string of Smalltalk code
export default getCode();
