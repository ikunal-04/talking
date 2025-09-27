import { createClient } from "@/lib/db/server";
import GoogleProvider from "next-auth/providers/google";

export const authOptions = {
    providers: [
        GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        })
    ],
    callbacks: {
        async signIn({ user, account }: { user: any, account: any }) {
            if (!user.email) return false;

            try {
                const supabase = await createClient();
                const { data: existingUser, error: checkError } = await supabase
                    .from("users")
                    .select("id")
                    .eq("email", user.email)
                    .single();

                if (checkError && checkError.code !== 'PGRST116') {
                    console.error("error from database")
                    return false;
                }

                console.log("users object returning from google", user);

                if (!existingUser) {
                    const { error: insertError } = await supabase.from("users").insert({
                        email: user.email,
                        name: user.name,
                        imageUrl: user.image,
                        userId: user.id
                    });

                    if (insertError) {
                        console.error("Database insert error:", insertError);
                        return false;
                    }
                }

                return true;
            } catch (error) {
                console.error("SignIn callback error:", error);
                return false;
            }
        },
        async jwt({ token, account }: { token: any, account: any }) {
            if (account) {
                token.accessToken = account.access_token;
            }
            return token;
        },
        async session({ session, token }: { session: any, token: any }) {
            if (session.user) {
                session.accessToken = token.accessToken;
            }
            return session;
        },
        async redirect({ url, baseUrl }: { url: string, baseUrl: string }) {
            // Allows relative callback URLs
            if (url.startsWith("/")) return `${baseUrl}${url}`
            // Allows callback URLs on the same origin
            else if (new URL(url).origin === baseUrl) return url
            return baseUrl
        }
    }
};