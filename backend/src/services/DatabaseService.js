// This service handles MongoDB retrieval operations including lexical search and data hydration by IDs.
import mongoose from 'mongoose';

const { ObjectId } = mongoose.Types;

export async function lexicalSearch(queryText, limitK = 50) {
    const db = mongoose.connection.db;
    const collection = db.collection('chunks');

    const cursor = collection.find(
        { $text: { $search: queryText } },
        { projection: { score: { $meta: "textScore" } } }
    )
    .sort({ score: { $meta: "textScore" } })
    .limit(limitK);

    const docs = await cursor.toArray();
    return docs.map(doc => ({
        _id: doc._id.toString(),
        score: doc.score
    }));
}

export async function getChunksByIds(idArray) {
    const db = mongoose.connection.db;
    const collection = db.collection('chunks');

    const queryIds = idArray.map(id => {
        if (typeof id === 'string' && id.length === 24 && /^[0-9a-fA-F]+$/.test(id)) {
            return new ObjectId(id);
        }
        return id;
    });

    const docs = await collection.find({ _id: { $in: queryIds } }).toArray();

    const docMap = new Map();
    docs.forEach(doc => {
        docMap.set(doc._id.toString(), doc);
    });

    return idArray.map(id => docMap.get(id)).filter(doc => doc !== undefined);
}
