// OOP tag bits (from gcioop.ht)
export const OOP_NUM_TAG_BITS = 3;
export const OOP_TAG_SMALLINT = 0x2;
export const OOP_TAG_SMALLDOUBLE = 0x6;
export const OOP_TAG_SPECIAL = 0x4;

// Well-known OOP values (from gcioop.ht)
export const OOP_ILLEGAL = 0x01n;
export const OOP_NIL = 0x14n;
export const OOP_FALSE = 0x0Cn;
export const OOP_TRUE = 0x10Cn;
export const OOP_ASCII_NUL = 0x1Cn;

// SmallInteger OOPs (computed via GCI_I32_TO_OOP macro)
export const OOP_Zero = 0x02n;
export const OOP_One = 0x0An;
export const OOP_Two = 0x12n;
export const OOP_Three = 0x1An;
export const OOP_Four = 0x22n;

// Perform flags (from gcicmn.ht)
export const GCI_PERFORM_FLAG_ENABLE_DEBUG = 1;

// Class OOPs (from gcioop.ht)
export const OOP_CLASS_BOOLEAN = 68097n;
export const OOP_CLASS_CHARACTER = 68353n;
export const OOP_CLASS_SMALL_INTEGER = 74241n;
export const OOP_CLASS_UNDEFINED_OBJECT = 76289n;
export const OOP_CLASS_SMALL_DOUBLE = 121345n;
