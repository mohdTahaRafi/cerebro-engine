// This service handles MongoDB lexical search queries using the full-text index.
import mongoose from 'mongoose';

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
