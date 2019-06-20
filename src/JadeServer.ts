/*
 *	JadeServer.ts
 *
 *  const myString = session.stringFromPerform(jadeServer, 'getSymbolList', [], 1024);
 */

const methods = [
`getSymbolList 
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
        print: each size;
        nextPutAll: '}';
        yourself.
    comma := ','.
    ].
    stream nextPutAll: ']}'.
    ^stream contents.`
,
`getDictionary: aSymbolDictionary
| comma dict stream |
stream := WriteStream on: String new.
stream nextPutAll: '{"list":['.
comma := ''.
aSymbolDictionary keysAndValuesDo: [:eachKey :eachValue | 
    stream 
        nextPutAll: comma;
        nextPutAll: '{"key":"';
        nextPutAll: eachKey asString;
        nextPutAll: '","oop":';
        print: eachValue asOop;
        nextPutAll: ',"class":"';
        nextPutAll: eachValue class name asString;
        nextPutAll: '","classOop":';
        print: eachValue class asOop;
        nextPutAll: '}';
        yourself.
    comma := ','.
].
stream nextPutAll: ']}'.
^stream contents.`
];

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
    result ~~ nil ifTrue: [^GsNMethod _sourceWithErrors: result fromString: source].`;
});
    code = code + `
    class new "initialize"
] on: (symbolList objectNamed: #Error) do: [:ex | 
    ex return: 'ERROR: ' , (GsProcess stackReportToLevel: 100)
]`;

export default code;