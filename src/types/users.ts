
export type Users = {
    id: number;
    userId: string;
    name: string;
    email: string;
    imageUrl: string;
    plans: "FREE" | "PRO" | "ULTRA";
    createdAt: Date;
}
